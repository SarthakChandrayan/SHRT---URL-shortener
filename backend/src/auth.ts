import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { sendError } from "./errors.js";
import { prisma } from "./prisma.js";
import { API_KEY_PREFIX, hashApiKey } from "./secrets.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      authMethod?: "session" | "apiKey";
    }
  }
}

const baseUrl = process.env.NEON_AUTH_BASE_URL;
const jwksUrl = process.env.NEON_AUTH_JWKS_URL;

const issuer = baseUrl ? new URL(baseUrl).origin : null;
const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;

if (!baseUrl || !jwksUrl) {
  console.warn(
    "NEON_AUTH_BASE_URL / NEON_AUTH_JWKS_URL are not set. All authenticated routes will reject requests.",
  );
}

type Identity = { userId: string; method: "session" | "apiKey" };

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;

  if (!header?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.slice("bearer ".length).trim() || null;
}

/**
 * Verifies the Neon Auth (Managed Better Auth) bearer JWT on the request,
 * if present. Returns the authenticated user's id (the JWT `sub` claim) or
 * `null` when there is no valid session.
 */
async function verifySession(token: string): Promise<string | null> {
  if (!jwks || !issuer) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

async function verifyApiKey(token: string): Promise<string | null> {
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(token) },
    select: { id: true, userId: true },
  });

  if (!apiKey) {
    return null;
  }

  // Best effort; never block or fail the request on this bookkeeping write.
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return apiKey.userId;
}

async function identify(req: Request): Promise<Identity | null> {
  const token = bearerToken(req);

  if (!token) {
    return null;
  }

  if (token.startsWith(API_KEY_PREFIX)) {
    const userId = await verifyApiKey(token);
    return userId ? { userId, method: "apiKey" } : null;
  }

  const userId = await verifySession(token);
  return userId ? { userId, method: "session" } : null;
}

/** Accepts a Neon Auth session JWT or a SHRT API key. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const identity = await identify(req);

    if (!identity) {
      sendError(res, 401, "Sign in to continue");
      return;
    }

    req.userId = identity.userId;
    req.authMethod = identity.method;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Like `requireAuth`, but rejects API keys. Used for account-level actions
 * (managing keys, exporting or deleting data) that a leaked key shouldn't
 * be able to perform.
 */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  try {
    const identity = await identify(req);

    if (!identity) {
      sendError(res, 401, "Sign in to continue");
      return;
    }

    if (identity.method !== "session") {
      sendError(res, 403, "API keys can't be used for account settings");
      return;
    }

    req.userId = identity.userId;
    req.authMethod = identity.method;
    next();
  } catch (error) {
    next(error);
  }
}
