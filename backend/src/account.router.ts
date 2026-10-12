import { Router } from "express";
import { requireSession } from "./auth.js";
import { sendError } from "./errors.js";
import { prisma } from "./prisma.js";
import { generateApiKey } from "./secrets.js";
import { invalidateUrlListCache } from "./urls-list-cache.js";

const MAX_API_KEYS = 10;
const MAX_KEY_NAME_LENGTH = 48;

export const accountRouter = Router();

accountRouter.use(requireSession);

accountRouter.get("/keys", async (req, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true },
    });

    res.set("Cache-Control", "no-store");
    res.json(keys);
  } catch (error) {
    next(error);
  }
});

accountRouter.post("/keys", async (req, res, next) => {
  const rawName: unknown = req.body?.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";

  if (!name || name.length > MAX_KEY_NAME_LENGTH) {
    sendError(res, 400, `Name the key (1–${MAX_KEY_NAME_LENGTH} characters)`);
    return;
  }

  try {
    const count = await prisma.apiKey.count({ where: { userId: req.userId } });

    if (count >= MAX_API_KEYS) {
      sendError(res, 400, `You can have up to ${MAX_API_KEYS} API keys. Revoke one first.`);
      return;
    }

    const { key, prefix, hash } = generateApiKey();
    const created = await prisma.apiKey.create({
      data: { userId: req.userId!, name, prefix, keyHash: hash },
      select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true },
    });

    // The plaintext key is only ever returned here.
    res.status(201).set("Cache-Control", "no-store").json({ ...created, key });
  } catch (error) {
    next(error);
  }
});

accountRouter.delete("/keys/:id", async (req, res, next) => {
  try {
    const { count } = await prisma.apiKey.deleteMany({
      where: { id: req.params.id, userId: req.userId },
    });

    if (count === 0) {
      sendError(res, 404, "API key not found");
      return;
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** Everything SHRT stores about the user, as a downloadable JSON file. */
accountRouter.get("/export", async (req, res, next) => {
  try {
    const [urls, apiKeys] = await Promise.all([
      prisma.url.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          shortCode: true,
          originalUrl: true,
          tags: true,
          createdAt: true,
          expiresAt: true,
          maxClicks: true,
          passwordHash: true,
          clicks: {
            orderBy: { clickedAt: "asc" },
            select: {
              clickedAt: true,
              deviceType: true,
              browser: true,
              os: true,
              referrer: true,
              country: true,
            },
          },
        },
      }),
      prisma.apiKey.findMany({
        where: { userId: req.userId },
        select: { name: true, prefix: true, createdAt: true, lastUsedAt: true },
      }),
    ]);

    const date = new Date().toISOString().slice(0, 10);

    res
      .set("Cache-Control", "no-store")
      .attachment(`shrt-export-${date}.json`)
      .json({
        exportedAt: new Date().toISOString(),
        userId: req.userId,
        links: urls.map(({ passwordHash, ...url }) => ({
          ...url,
          passwordProtected: passwordHash !== null,
        })),
        apiKeys,
      });
  } catch (error) {
    next(error);
  }
});

/**
 * Deletes the user's links (and, by cascade, their clicks) and API keys.
 * The sign-in account itself lives in Neon Auth and is deleted by the client.
 */
accountRouter.delete("/", async (req, res, next) => {
  try {
    await prisma.$transaction([
      prisma.url.deleteMany({ where: { userId: req.userId } }),
      prisma.apiKey.deleteMany({ where: { userId: req.userId } }),
    ]);

    invalidateUrlListCache(req.userId!);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
