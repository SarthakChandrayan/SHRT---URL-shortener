import { Prisma } from "@prisma/client";
import { Router } from "express";
import { sendError } from "./errors.js";
import { parseOriginalUrl } from "./original-url.js";
import { prisma } from "./prisma.js";
import { generateShortCode } from "./short-code.js";

const MAX_SHORT_CODE_ATTEMPTS = 5;

export const urlsRouter = Router();

urlsRouter.get("/", async (_req, res, next) => {
  try {
    const urls = await prisma.url.findMany({
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
          select: { clickedAt: true },
          orderBy: { clickedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.set("Cache-Control", "no-store");
    res.json(
      urls.map((url) => ({
        id: url.id,
        originalUrl: url.originalUrl,
        shortCode: url.shortCode,
        createdAt: url.createdAt,
        expiresAt: url.expiresAt,
        clickCount: url._count.clicks,
        lastClickedAt: url.clicks[0]?.clickedAt ?? null,
      })),
    );
  } catch (error) {
    next(error);
  }
});

urlsRouter.post("/", async (req, res, next) => {
  const parsed = parseOriginalUrl(req.body?.originalUrl);

  if (!parsed.ok) {
    sendError(res, 400, parsed.error);
    return;
  }

  try {
    const url = await createUrl(parsed.href);
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

async function createUrl(originalUrl: string) {
  for (let attempt = 0; attempt < MAX_SHORT_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.url.create({
        data: {
          originalUrl,
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
