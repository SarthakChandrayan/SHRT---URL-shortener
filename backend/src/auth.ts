import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { sendError } from "./errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
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

/**
 * Verifies the Neon Auth (Managed Better Auth) bearer JWT on the request,
 * if present. Returns the authenticated user's id (the JWT `sub` claim) or
 * `null` when there is no valid session.
 */
async function verifyRequest(req: Request): Promise<string | null> {
  const header = req.headers.authorization;

  if (!header?.toLowerCase().startsWith("bearer ") || !jwks || !issuer) {
    return null;
  }

  const token = header.slice("bearer ".length).trim();

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Rejects the request with 401 unless it carries a valid Neon Auth session. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = await verifyRequest(req);

  if (!userId) {
    sendError(res, 401, "Sign in to continue");
    return;
  }

  req.userId = userId;
  next();
}
