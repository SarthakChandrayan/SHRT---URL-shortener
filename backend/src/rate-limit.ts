import "./env.js";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { sendError } from "./errors.js";
import { sendTooManyAttempts } from "./redirect.js";
import { userAgentKey } from "./traffic.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      skipClickTracking?: boolean;
    }
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`${name}="${raw}" is invalid; using ${fallback}`);
    return fallback;
  }

  return Math.floor(parsed);
}

/** Sliding window used by the create-URL limiter. Default 15 minutes. */
export const rateLimitWindowMs = envInt("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);

/**
 * POST /api/urls — 30 creates per window per IP.
 * Comfortable for a person making several links; tight enough to stop
 * automated spam without Redis or other shared stores.
 */
export const createUrlMax = envInt("RATE_LIMIT_CREATE_MAX", 30);

/** Shared window for both redirect limiters. Default 1 minute. */
export const redirectWindowMs = envInt("RATE_LIMIT_REDIRECT_WINDOW_MS", 60 * 1000);

/** Soft cap: recorded clicks per IP per redirect window. Default 60. */
export const redirectClickMax = envInt("RATE_LIMIT_REDIRECT_MAX", 60);

/** Hard cap: redirect requests per IP per window. Default 300. */
export const redirectHardMax = envInt("RATE_LIMIT_REDIRECT_HARD_MAX", 300);

export function isTrustProxyEnabled(): boolean {
  const raw = process.env.RATE_LIMIT_TRUST_PROXY?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export const createUrlLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  limit: createUrlMax,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, 429, "Too many requests. Try again later.");
  },
});

/**
 * Above this, skip Click inserts but still 302. Keyed by IP + browser so
 * many people behind one carrier/office IP (CGNAT) aren't counted as one.
 */
export const redirectClickLimiter = rateLimit({
  windowMs: redirectWindowMs,
  limit: redirectClickMax,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip ?? "")}:${userAgentKey(req.get("user-agent"))}`,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req, _res, next) => {
    req.skipClickTracking = true;
    next();
  },
});

/** Above this, refuse the request entirely. */
export const redirectHardLimiter = rateLimit({
  windowMs: redirectWindowMs,
  limit: redirectHardMax,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, 429, "Too many requests. Try again later.");
  },
});

/** Wrong-password guesses on protected links: 10 per IP per link per 15 min. */
export const linkPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}:${String(req.params.shortCode)}`,
  // Correct passwords redirect (3xx) and shouldn't use up attempts.
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode < 400,
  handler: sendTooManyAttempts,
});
