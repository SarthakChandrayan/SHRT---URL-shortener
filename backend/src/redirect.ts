import type { NextFunction, Request, Response } from "express";
import { SHORT_CODE_PATTERN } from "./alias.js";
import { parseClickRequest } from "./click-analytics.js";
import { sendError } from "./errors.js";
import { prisma } from "./prisma.js";
import { verifyLinkPassword } from "./secrets.js";

type Link = {
  id: string;
  shortCode: string;
  originalUrl: string;
  passwordHash: string | null;
};

type Resolved = { ok: true; link: Link } | { ok: false; reason: DeadReason };

/** Looks up a short code and applies expiry and click-limit rules. */
async function resolveLink(shortCode: unknown): Promise<Resolved> {
  if (typeof shortCode !== "string" || !SHORT_CODE_PATTERN.test(shortCode)) {
    return { ok: false, reason: "missing" };
  }

  const url = await prisma.url.findUnique({
    where: { shortCode },
    select: {
      id: true,
      shortCode: true,
      originalUrl: true,
      expiresAt: true,
      passwordHash: true,
      maxClicks: true,
    },
  });

  if (!url) {
    return { ok: false, reason: "missing" };
  }

  if (url.expiresAt && url.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  if (url.maxClicks !== null) {
    const clicks = await prisma.click.count({ where: { urlId: url.id } });
    if (clicks >= url.maxClicks) {
      return { ok: false, reason: "limit" };
    }
  }

  return { ok: true, link: url };
}

export async function redirectToOriginalUrl(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const resolved = await resolveLink(req.params.shortCode);

    if (!resolved.ok) {
      sendDeadLink(req, res, resolved.reason);
      return;
    }

    if (resolved.link.passwordHash) {
      sendPasswordPrompt(req, res, resolved.link.shortCode, null);
      return;
    }

    await recordClick(req, resolved.link);
    sendRedirect(res, resolved.link.originalUrl, 302);
  } catch (error) {
    next(error);
  }
}

/** POST /:shortCode — the password form on protected links submits here. */
export async function unlockProtectedLink(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const resolved = await resolveLink(req.params.shortCode);

    if (!resolved.ok) {
      sendDeadLink(req, res, resolved.reason);
      return;
    }

    const { link } = resolved;
    const password: unknown = req.body?.password;

    if (!link.passwordHash) {
      sendRedirect(res, link.originalUrl, 303);
      return;
    }

    if (
      typeof password !== "string" ||
      password.length > 256 ||
      !(await verifyLinkPassword(password, link.passwordHash))
    ) {
      sendPasswordPrompt(req, res, link.shortCode, "That password isn't right. Try again.");
      return;
    }

    await recordClick(req, link);
    // 303 so the browser follows with a GET instead of re-POSTing the form.
    sendRedirect(res, link.originalUrl, 303);
  } catch (error) {
    next(error);
  }
}

async function recordClick(req: Request, link: Link) {
  if (req.skipClickTracking) {
    return;
  }

  try {
    const analytics = await parseClickRequest(
      req.get("user-agent"),
      req.get("referer"),
      req.ip ?? req.socket.remoteAddress,
      (name) => req.get(name),
    );

    await prisma.click.create({
      data: {
        urlId: link.id,
        deviceType: analytics.deviceType,
        browser: analytics.browser,
        os: analytics.os,
        referrer: analytics.referrer,
        country: analytics.country,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.name : "unknown";
    console.error(`Failed to record click for ${link.shortCode}: ${detail}`);
  }
}

function sendRedirect(res: Response, location: string, status: 302 | 303) {
  // Never let browsers or CDNs cache the redirect, or repeat visits would
  // skip click tracking and edits to the destination wouldn't take effect.
  res.set("Cache-Control", "private, no-store");
  res.redirect(status, location);
}

const APP_URL = escapeHtml(process.env.PUBLIC_APP_URL?.trim() || "/");

type DeadReason = "missing" | "expired" | "limit";

const DEAD_LINKS: Record<
  DeadReason,
  { status: 404 | 410; title: string; message: string; apiError: string }
> = {
  missing: {
    status: 404,
    title: "Link not found",
    message: "This short link doesn't exist. Check the address for typos.",
    apiError: "Short URL not found",
  },
  expired: {
    status: 410,
    title: "Link expired",
    message: "The owner of this short link set it to expire, and it has.",
    apiError: "This short URL has expired",
  },
  limit: {
    status: 410,
    title: "Link no longer available",
    message: "This short link has reached the maximum number of visits its owner allowed.",
    apiError: "This short URL has reached its click limit",
  },
};

// `*/*` (curl, fetch) resolves to the first option, so only clients that
// explicitly ask for HTML — i.e. browsers — get a page.
function wantsHtml(req: Request): boolean {
  return req.accepts(["json", "html"]) === "html";
}

function sendDeadLink(req: Request, res: Response, reason: DeadReason) {
  const copy = DEAD_LINKS[reason];

  if (!wantsHtml(req)) {
    sendError(res, copy.status, copy.apiError);
    return;
  }

  sendPage(res, copy.status, {
    title: copy.title,
    kicker: `ERROR ${copy.status}`,
    body: `<p>${copy.message}</p>
  <a class="button" href="${APP_URL}">Create your own short link</a>`,
  });
}

function sendPasswordPrompt(
  req: Request,
  res: Response,
  shortCode: string,
  error: string | null,
) {
  if (!wantsHtml(req)) {
    sendError(
      res,
      401,
      error ?? "This link is password protected. POST { password } to unlock it.",
    );
    return;
  }

  sendPage(res, error ? 401 : 200, {
    title: "Password required",
    kicker: "PROTECTED LINK",
    body: `<p>The owner of this link protected it with a password.</p>
  <form method="post" action="/${escapeHtml(shortCode)}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="off" required autofocus maxlength="256">
    ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
    <button class="button" type="submit">Continue</button>
  </form>`,
  });
}

export function sendTooManyAttempts(req: Request, res: Response) {
  if (!wantsHtml(req)) {
    sendError(res, 429, "Too many password attempts. Try again later.");
    return;
  }

  sendPage(res, 429, {
    title: "Too many attempts",
    kicker: "SLOW DOWN",
    body: "<p>Too many wrong passwords from your network. Wait a few minutes and try again.</p>",
  });
}

function sendPage(
  res: Response,
  status: number,
  page: { title: string; kicker: string; body: string },
) {
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
<title>${page.title} · SHRT</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #eaf4f8;
    background: radial-gradient(ellipse 60% 50% at 20% 90%, rgba(232,96,42,.35), transparent 70%),
      radial-gradient(ellipse 60% 50% at 85% 10%, rgba(62,198,216,.3), transparent 70%), #030508; }
  main { width: 100%; max-width: 420px; box-sizing: border-box; padding: 32px 28px;
    background: rgba(6,12,16,.85); border: 1px solid rgba(210,245,252,.2); }
  .kicker { margin: 0 0 12px; font: 12px ui-monospace, monospace; letter-spacing: .14em; color: #3ec6d8; }
  h1 { margin: 0 0 10px; font-size: 1.6rem; font-weight: 600; letter-spacing: -.02em; }
  p { margin: 0 0 24px; line-height: 1.5; color: #9fb3bf; }
  form { display: grid; gap: 10px; }
  label { font: 11px ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: #9fb3bf; }
  input { height: 46px; padding: 0 14px; font: inherit; color: #eaf4f8; background: #05080c;
    border: 1px solid #2a4552; outline: none; }
  input:focus { border-color: #9aeef5; }
  .error { margin: 0; color: #ff6b5a; font-size: .9rem; }
  .button { display: inline-block; padding: 13px 18px; font: inherit; font-weight: 600; font-size: .85rem;
    letter-spacing: .04em; text-transform: uppercase; text-decoration: none; text-align: center;
    color: #041016; background: linear-gradient(180deg, #9aeef5, #2bb8cb); border: 0; cursor: pointer; }
</style>
</head>
<body>
<main>
  <p class="kicker">${page.kicker}</p>
  <h1>${page.title}</h1>
  ${page.body}
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
