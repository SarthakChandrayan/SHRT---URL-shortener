import type { NextFunction, Request, Response } from "express";
import { SHORT_CODE_PATTERN } from "./alias.js";
import { parseClickRequest } from "./click-analytics.js";
import { sendError } from "./errors.js";
import { prisma } from "./prisma.js";

export async function redirectToOriginalUrl(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const shortCode = req.params.shortCode;

    if (typeof shortCode !== "string" || !SHORT_CODE_PATTERN.test(shortCode)) {
      sendDeadLink(req, res, 404);
      return;
    }

    const url = await prisma.url.findUnique({
      where: { shortCode },
      select: { id: true, shortCode: true, originalUrl: true, expiresAt: true },
    });

    if (!url) {
      sendDeadLink(req, res, 404);
      return;
    }

    if (url.expiresAt && url.expiresAt.getTime() <= Date.now()) {
      sendDeadLink(req, res, 410);
      return;
    }

    if (!req.skipClickTracking) {
      try {
        const analytics = await parseClickRequest(
          req.get("user-agent"),
          req.get("referer"),
          req.ip ?? req.socket.remoteAddress,
          (name) => req.get(name),
        );

        await prisma.click.create({
          data: {
            urlId: url.id,
            deviceType: analytics.deviceType,
            browser: analytics.browser,
            os: analytics.os,
            referrer: analytics.referrer,
            country: analytics.country,
          },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.name : "unknown";
        console.error(`Failed to record click for ${url.shortCode}: ${detail}`);
      }
    }

    // Never let browsers or CDNs cache the redirect, or repeat visits would
    // skip click tracking and edits to the destination wouldn't take effect.
    res.set("Cache-Control", "private, no-store");
    res.redirect(302, url.originalUrl);
  } catch (error) {
    next(error);
  }
}

const APP_URL = escapeHtml(process.env.PUBLIC_APP_URL?.trim() || "/");

const DEAD_LINK_COPY = {
  404: {
    title: "Link not found",
    message: "This short link doesn't exist. Check the address for typos.",
  },
  410: {
    title: "Link expired",
    message: "The owner of this short link set it to expire, and it has.",
  },
} as const;

/** Browsers get a small branded page; API clients keep getting JSON. */
function sendDeadLink(req: Request, res: Response, status: 404 | 410) {
  const copy = DEAD_LINK_COPY[status];

  // `*/*` (curl, fetch) resolves to the first option, so only clients that
  // explicitly ask for HTML — i.e. browsers — get the page.
  if (req.accepts(["json", "html"]) !== "html") {
    sendError(
      res,
      status,
      status === 404 ? "Short URL not found" : "This short URL has expired",
    );
    return;
  }

  res
    .status(status)
    .set("Cache-Control", "no-store")
    .type("html")
    .send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${copy.title} · SHRT</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #eaf4f8;
    background: radial-gradient(ellipse 60% 50% at 20% 90%, rgba(232,96,42,.35), transparent 70%),
      radial-gradient(ellipse 60% 50% at 85% 10%, rgba(62,198,216,.3), transparent 70%), #030508; }
  main { max-width: 420px; padding: 32px 28px; background: rgba(6,12,16,.85);
    border: 1px solid rgba(210,245,252,.2); }
  .code { margin: 0 0 12px; font: 12px ui-monospace, monospace; letter-spacing: .14em; color: #3ec6d8; }
  h1 { margin: 0 0 10px; font-size: 1.6rem; font-weight: 600; letter-spacing: -.02em; }
  p { margin: 0 0 24px; line-height: 1.5; color: #9fb3bf; }
  a { display: inline-block; padding: 12px 18px; font-weight: 600; font-size: .85rem;
    letter-spacing: .04em; text-transform: uppercase; text-decoration: none; color: #041016;
    background: linear-gradient(180deg, #9aeef5, #2bb8cb); }
</style>
</head>
<body>
<main>
  <p class="code">ERROR ${status}</p>
  <h1>${copy.title}</h1>
  <p>${copy.message}</p>
  <a href="${APP_URL}">Create your own short link</a>
</main>
</body>
</html>`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
