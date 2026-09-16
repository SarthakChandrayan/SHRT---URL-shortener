import { Prisma } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { summarizeClicks } from "./click-analytics.js";
import { sendError } from "./errors.js";
import { parseExpiresAt } from "./expires-at.js";
import { parseOriginalUrl } from "./original-url.js";
import { prisma } from "./prisma.js";
import { createUrlLimiter } from "./rate-limit.js";
import { generateShortCode } from "./short-code.js";
import {
  getCachedUrlList,
  invalidateUrlListCache,
  setCachedUrlList,
} from "./urls-list-cache.js";

const MAX_SHORT_CODE_ATTEMPTS = 5;

export const urlsRouter = Router();

urlsRouter.get("/", requireAuth, async (req, res, next) => {
  const userId = req.userId!;

  try {
    const cached = getCachedUrlList(userId);

    if (cached !== undefined) {
      res.set("Cache-Control", "no-store");
      res.json(cached);
      return;
    }

    const urls = await prisma.url.findMany({
      where: { userId },
      select: {
        id: true,
        originalUrl: true,
        shortCode: true,
        createdAt: true,
        expiresAt: true,
        _count: {
          select: { clicks: true },
        },
        clicks: {
          select: {
            clickedAt: true,
            deviceType: true,
            browser: true,
            os: true,
            referrer: true,
          },
          orderBy: { clickedAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const payload = urls.map((url) => ({
      id: url.id,
      originalUrl: url.originalUrl,
      shortCode: url.shortCode,
      createdAt: url.createdAt,
      expiresAt: url.expiresAt,
      clickCount: url._count.clicks,
      lastClickedAt: url.clicks[0]?.clickedAt ?? null,
      analytics: summarizeClicks(url.clicks),
    }));

    setCachedUrlList(userId, payload);
    res.set("Cache-Control", "no-store");
    res.json(payload);
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

  try {
    const url = await createUrl(parsed.href, req.userId!, expiration.expiresAt);
    invalidateUrlListCache(req.userId!);
    res.status(201).json(url);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "SHORT_CODE_GENERATION_FAILED"
    ) {
      sendError(res, 500, "Could not generate a unique short code");
      return;
    }

    next(error);
  }
});

urlsRouter.patch("/:id", requireAuth, async (req, res, next) => {
  const id = req.params.id;

  if (typeof id !== "string" || id.trim() === "") {
    sendError(res, 404, "Short URL not found");
    return;
  }

  if (!("expiresAt" in (req.body ?? {}))) {
    sendError(res, 400, "expiresAt is required");
    return;
  }

  const expiration = parseExpiresAt(req.body.expiresAt);

  if (!expiration.ok) {
    sendError(res, 400, expiration.error);
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
      data: { expiresAt: expiration.expiresAt },
      select: {
        id: true,
        originalUrl: true,
        shortCode: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    invalidateUrlListCache(req.userId!);
    res.json(url);
  } catch (error) {
    next(error);
  }
});

async function createUrl(
  originalUrl: string,
  userId: string,
  expiresAt: Date | null,
) {
  for (let attempt = 0; attempt < MAX_SHORT_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.url.create({
        data: {
          originalUrl,
          userId,
          expiresAt,
          shortCode: generateShortCode(),
        },
      });
    } catch (error) {
      const isUniqueConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";

      if (isUniqueConflict && attempt < MAX_SHORT_CODE_ATTEMPTS - 1) {
        continue;
      }

      if (isUniqueConflict) {
        throw new Error("SHORT_CODE_GENERATION_FAILED");
      }

      throw error;
    }
  }

  throw new Error("SHORT_CODE_GENERATION_FAILED");
}
