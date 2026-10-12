import { Prisma } from "@prisma/client";
import { Router } from "express";
import { parseAlias } from "./alias.js";
import {
  addDays,
  getAnalytics,
  buildLinkListQuery,
  getOverview,
  parseAnalyticsRange,
  todayIn,
  parseTimezone,
} from "./analytics.js";
import { requireAuth } from "./auth.js";
import { HttpError, sendError } from "./errors.js";
import { parseExpiresAt } from "./expires-at.js";
import { parseOriginalUrl } from "./original-url.js";
import { parseLinkPassword, parseMaxClicks, parseTags } from "./link-options.js";
import { prisma } from "./prisma.js";
import { createUrlLimiter } from "./rate-limit.js";
import { hashLinkPassword } from "./secrets.js";
import { generateShortCode } from "./short-code.js";
import {
  getCachedUrlList,
  invalidateUrlListCache,
  setCachedUrlList,
} from "./urls-list-cache.js";

const MAX_SHORT_CODE_ATTEMPTS = 5;

const PUBLIC_URL_SELECT = {
  id: true,
  originalUrl: true,
  shortCode: true,
  createdAt: true,
  expiresAt: true,
  tags: true,
  maxClicks: true,
  passwordHash: true,
} as const;

/** Never send the password hash to clients; just whether one is set. */
function toPublicUrl<T extends { passwordHash: string | null }>({
  passwordHash,
  ...url
}: T) {
  return { ...url, hasPassword: passwordHash !== null };
}

export const urlsRouter = Router();

urlsRouter.get("/", requireAuth, async (req, res, next) => {
  const userId = req.userId!;
  const timezone = parseTimezone(req.query.tz) ?? "UTC";

  try {
    const cached = getCachedUrlList(userId, timezone);

    if (cached !== undefined) {
      res.set("Cache-Control", "no-store");
      res.json(cached);
      return;
    }

    const payload = await listOwnedUrlStats(userId, timezone);

    setCachedUrlList(userId, timezone, payload);
    res.set("Cache-Control", "no-store");
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

/** Account-wide analytics across all of the user's links. */
urlsRouter.get("/overview", requireAuth, async (req, res, next) => {
  const range = parseAnalyticsRange(req.query);

  if (!range.ok) {
    sendError(res, 400, range.error);
    return;
  }

  try {
    const overview = await getOverview(req.userId!, range.range);
    res.set("Cache-Control", "no-store");
    res.json(overview);
  } catch (error) {
    next(error);
  }
});

urlsRouter.post("/", createUrlLimiter, requireAuth, async (req, res, next) => {
  const parsed = parseOriginalUrl(req.body?.originalUrl);

  if (!parsed.ok) {
    sendError(res, 400, parsed.error);
    return;
  }

  const expiration = parseExpiresAt(req.body?.expiresAt);

  if (!expiration.ok) {
    sendError(res, 400, expiration.error);
    return;
  }

  const alias = parseAlias(req.body?.alias);

  if (!alias.ok) {
    sendError(res, 400, alias.error);
    return;
  }

  const tags = parseTags(req.body?.tags);
  const password = parseLinkPassword(req.body?.password);
  const maxClicks = parseMaxClicks(req.body?.maxClicks);

  for (const result of [tags, password, maxClicks]) {
    if (!result.ok) {
      sendError(res, 400, result.error);
      return;
    }
  }

  try {
    const url = await createUrl({
      originalUrl: parsed.href,
      userId: req.userId!,
      expiresAt: expiration.expiresAt,
      alias: alias.alias,
      tags: tags.ok ? tags.value : [],
      passwordHash:
        password.ok && password.value ? await hashLinkPassword(password.value) : null,
      maxClicks: maxClicks.ok ? maxClicks.value : null,
    });
    invalidateUrlListCache(req.userId!);
    res.status(201).json(url);
  } catch (error) {
    next(error);
  }
});

urlsRouter.get("/alias-availability", requireAuth, async (req, res, next) => {
  const alias = parseAlias(req.query.alias);

  if (!alias.ok) {
    res.json({ available: false, reason: alias.error });
    return;
  }

  if (!alias.alias) {
    sendError(res, 400, "alias is required");
    return;
  }

  try {
    const existing = await prisma.url.findUnique({
      where: { shortCode: alias.alias },
      select: { id: true },
    });

    res.set("Cache-Control", "no-store");
    res.json(
      existing
        ? { available: false, reason: "That alias is already taken" }
        : { available: true },
    );
  } catch (error) {
    next(error);
  }
});

urlsRouter.get("/:id/analytics", requireAuth, async (req, res, next) => {
  const id = req.params.id;

  if (typeof id !== "string" || id.trim() === "") {
    sendError(res, 404, "Short URL not found");
    return;
  }

  const range = parseAnalyticsRange(req.query);

  if (!range.ok) {
    sendError(res, 400, range.error);
    return;
  }

  try {
    const existing = await prisma.url.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });

    if (!existing) {
      sendError(res, 404, "Short URL not found");
      return;
    }

    const analytics = await getAnalytics({ kind: "url", urlId: existing.id }, range.range);
    res.set("Cache-Control", "no-store");
    res.json(analytics);
  } catch (error) {
    next(error);
  }
});

urlsRouter.patch("/:id", requireAuth, async (req, res, next) => {
  const id = req.params.id;

  if (typeof id !== "string" || id.trim() === "") {
    sendError(res, 404, "Short URL not found");
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const data: Prisma.UrlUpdateInput = {};

  if ("originalUrl" in body) {
    const parsed = parseOriginalUrl(body.originalUrl);

    if (!parsed.ok) {
      sendError(res, 400, parsed.error);
      return;
    }

    data.originalUrl = parsed.href;
  }

  if ("expiresAt" in body) {
    const expiration = parseExpiresAt(body.expiresAt);

    if (!expiration.ok) {
      sendError(res, 400, expiration.error);
      return;
    }

    data.expiresAt = expiration.expiresAt;
  }

  if ("tags" in body) {
    const tags = parseTags(body.tags);

    if (!tags.ok) {
      sendError(res, 400, tags.error);
      return;
    }

    data.tags = tags.value;
  }

  if ("maxClicks" in body) {
    const maxClicks = parseMaxClicks(body.maxClicks);

    if (!maxClicks.ok) {
      sendError(res, 400, maxClicks.error);
      return;
    }

    data.maxClicks = maxClicks.value;
  }

  // `password: null` removes protection; a string sets a new password.
  if ("password" in body) {
    const password = parseLinkPassword(body.password);

    if (!password.ok) {
      sendError(res, 400, password.error);
      return;
    }

    data.passwordHash = password.value ? await hashLinkPassword(password.value) : null;
  }

  if (Object.keys(data).length === 0) {
    sendError(
      res,
      400,
      "Provide at least one of originalUrl, expiresAt, tags, maxClicks or password",
    );
    return;
  }

  try {
    const existing = await prisma.url.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });

    if (!existing) {
      sendError(res, 404, "Short URL not found");
      return;
    }

    const url = await prisma.url.update({
      where: { id: existing.id },
      data,
      select: PUBLIC_URL_SELECT,
    });

    invalidateUrlListCache(req.userId!);
    res.json(toPublicUrl(url));
  } catch (error) {
    next(error);
  }
});

urlsRouter.delete("/:id", requireAuth, async (req, res, next) => {
  const id = req.params.id;

  if (typeof id !== "string" || id.trim() === "") {
    sendError(res, 404, "Short URL not found");
    return;
  }

  try {
    // Scoping by userId makes this a no-op for links the caller doesn't own.
    const { count } = await prisma.url.deleteMany({
      where: { id, userId: req.userId },
    });

    if (count === 0) {
      sendError(res, 404, "Short URL not found");
      return;
    }

    invalidateUrlListCache(req.userId!);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

const SPARKLINE_DAYS = 14;

type UrlStatsRow = {
  id: string;
  originalUrl: string;
  shortCode: string;
  createdAt: Date;
  expiresAt: Date | null;
  tags: string[] | null;
  maxClicks: number | null;
  hasPassword: boolean;
  clickCount: number;
  lastClickedAt: Date | null;
  recentClicks: number[] | null;
};

/**
 * The link list: settings, all-time click count, and a daily sparkline of
 * the last 14 days in the viewer's timezone. Detailed breakdowns live in the
 * per-link analytics endpoint, so this stays cheap as clicks grow.
 */
async function listOwnedUrlStats(userId: string, timezone: string) {
  const endDate = todayIn(timezone);
  const startDate = addDays(endDate, -(SPARKLINE_DAYS - 1));

  const urls = await prisma.$queryRaw<UrlStatsRow[]>(
    buildLinkListQuery(userId, startDate, endDate, timezone),
  );

  return urls.map((url) => ({
    id: url.id,
    originalUrl: url.originalUrl,
    shortCode: url.shortCode,
    createdAt: url.createdAt,
    expiresAt: url.expiresAt,
    tags: url.tags ?? [],
    maxClicks: url.maxClicks,
    hasPassword: Boolean(url.hasPassword),
    clickCount: Number(url.clickCount),
    lastClickedAt: url.lastClickedAt,
    recentClicks: (url.recentClicks ?? []).map(Number),
  }));
}

type NewUrl = {
  originalUrl: string;
  userId: string;
  expiresAt: Date | null;
  alias: string | null;
  tags: string[];
  passwordHash: string | null;
  maxClicks: number | null;
};

async function createUrl({ alias, ...fields }: NewUrl) {
  if (alias) {
    try {
      const url = await prisma.url.create({
        data: { ...fields, shortCode: alias },
        select: PUBLIC_URL_SELECT,
      });
      return toPublicUrl(url);
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new HttpError(409, "That alias is already taken");
      }

      throw error;
    }
  }

  for (let attempt = 0; attempt < MAX_SHORT_CODE_ATTEMPTS; attempt += 1) {
    try {
      const url = await prisma.url.create({
        data: { ...fields, shortCode: generateShortCode() },
        select: PUBLIC_URL_SELECT,
      });
      return toPublicUrl(url);
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
    }
  }

  throw new HttpError(500, "Could not generate a unique short code");
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
