import { Prisma } from "@prisma/client";
import { Router } from "express";
import { parseAlias } from "./alias.js";
import { requireAuth } from "./auth.js";
import type { ClickBreakdown } from "./click-analytics.js";
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

  try {
    const cached = getCachedUrlList(userId);

    if (cached !== undefined) {
      res.set("Cache-Control", "no-store");
      res.json(cached);
      return;
    }

    const payload = await listOwnedUrlStats(userId);

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

    const [data, devices] = await Promise.all([
      listUrlClicksByDay(existing.id, range.startDate, range.endDate),
      listUrlClicksByDevice(existing.id, range.startDate, range.endDate),
    ]);

    res.set("Cache-Control", "no-store");
    res.json({
      startDate: range.startDate,
      endDate: range.endDate,
      data,
      devices,
    });
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

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 90;

type AnalyticsRange =
  | { ok: true; startDate: string; endDate: string }
  | { ok: false; error: string };

function utcDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDay(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = ISO_DAY.exec(value.trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));

  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function addUtcDays(isoDay: string, days: number): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return utcDayString(date);
}

function inclusiveDayCount(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function parseAnalyticsRange(query: {
  startDate?: unknown;
  endDate?: unknown;
}): AnalyticsRange {
  if (Array.isArray(query.startDate) || Array.isArray(query.endDate)) {
    return { ok: false, error: "startDate and endDate must be YYYY-MM-DD" };
  }

  const today = utcDayString(new Date());
  let endDate: string;
  let startDate: string;

  if (query.endDate === undefined || query.endDate === "") {
    endDate = today;
  } else {
    const parsed = parseIsoDay(query.endDate);

    if (!parsed) {
      return { ok: false, error: "endDate must be YYYY-MM-DD" };
    }

    endDate = parsed;
  }

  if (query.startDate === undefined || query.startDate === "") {
    startDate = addUtcDays(endDate, -(DEFAULT_RANGE_DAYS - 1));
  } else {
    const parsed = parseIsoDay(query.startDate);

    if (!parsed) {
      return { ok: false, error: "startDate must be YYYY-MM-DD" };
    }

    startDate = parsed;
  }

  if (startDate > endDate) {
    return { ok: false, error: "startDate must be on or before endDate" };
  }

  if (inclusiveDayCount(startDate, endDate) > MAX_RANGE_DAYS) {
    return {
      ok: false,
      error: `Date range must be ${MAX_RANGE_DAYS} days or fewer`,
    };
  }

  return { ok: true, startDate, endDate };
}

type DailyClickRow = {
  date: string;
  clicks: number;
};

async function listUrlClicksByDay(
  urlId: string,
  startDate: string,
  endDate: string,
): Promise<DailyClickRow[]> {
  const rows = await prisma.$queryRaw<DailyClickRow[]>(Prisma.sql`
    WITH days AS (
      SELECT generate_series(
        ${startDate}::date,
        ${endDate}::date,
        INTERVAL '1 day'
      )::date AS date
    ),
    counts AS (
      SELECT
        "clickedAt"::date AS date,
        COUNT(*)::int AS clicks
      FROM "Click"
      WHERE "urlId" = ${urlId}
        AND "clickedAt" >= ${startDate}::date
        AND "clickedAt" < (${endDate}::date + INTERVAL '1 day')
      GROUP BY 1
    )
    SELECT
      to_char(days.date, 'YYYY-MM-DD') AS date,
      COALESCE(counts.clicks, 0)::int AS clicks
    FROM days
    LEFT JOIN counts ON counts.date = days.date
    ORDER BY days.date
  `);

  return rows.map((row) => ({
    date: row.date,
    clicks: Number(row.clicks),
  }));
}

type DeviceClickRow = {
  deviceType: string;
  clicks: number;
};

async function listUrlClicksByDevice(
  urlId: string,
  startDate: string,
  endDate: string,
): Promise<DeviceClickRow[]> {
  const rows = await prisma.$queryRaw<DeviceClickRow[]>(Prisma.sql`
    WITH categories AS (
      SELECT unnest(ARRAY['desktop', 'mobile', 'tablet', 'unknown']) AS "deviceType"
    ),
    counts AS (
      SELECT
        CASE
          WHEN "deviceType" IN ('desktop', 'mobile', 'tablet') THEN "deviceType"
          ELSE 'unknown'
        END AS "deviceType",
        COUNT(*)::int AS clicks
      FROM "Click"
      WHERE "urlId" = ${urlId}
        AND "clickedAt" >= ${startDate}::date
        AND "clickedAt" < (${endDate}::date + INTERVAL '1 day')
      GROUP BY 1
    )
    SELECT
      categories."deviceType",
      COALESCE(counts.clicks, 0)::int AS clicks
    FROM categories
    LEFT JOIN counts ON counts."deviceType" = categories."deviceType"
    ORDER BY
      CASE categories."deviceType"
        WHEN 'desktop' THEN 0
        WHEN 'mobile' THEN 1
        WHEN 'tablet' THEN 2
        ELSE 3
      END
  `);

  return rows.map((row) => ({
    deviceType: row.deviceType,
    clicks: Number(row.clicks),
  }));
}

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
  devices: ClickBreakdown[] | null;
  browsers: ClickBreakdown[] | null;
  operatingSystems: ClickBreakdown[] | null;
  referrers: ClickBreakdown[] | null;
  countries: ClickBreakdown[] | null;
};

async function listOwnedUrlStats(userId: string) {
  const urls = await prisma.$queryRaw<UrlStatsRow[]>(Prisma.sql`
    WITH user_urls AS (
      SELECT
        id,
        "originalUrl",
        "shortCode",
        "createdAt",
        "expiresAt",
        tags,
        "maxClicks",
        "passwordHash" IS NOT NULL AS "hasPassword"
      FROM "Url"
      WHERE "userId" = ${userId}
    ),
    click_stats AS (
      SELECT
        "urlId",
        COUNT(*)::int AS "clickCount",
        MAX("clickedAt") AS "lastClickedAt"
      FROM "Click"
      WHERE "urlId" IN (SELECT id FROM user_urls)
      GROUP BY "urlId"
    ),
    devices AS (
      SELECT
        "urlId",
        json_agg(
          json_build_object('label', label, 'count', count)
          ORDER BY count DESC, lower(label), label
        ) AS devices
      FROM (
        SELECT
          "urlId",
          "deviceType" AS label,
          COUNT(*)::int AS count
        FROM "Click"
        WHERE "urlId" IN (SELECT id FROM user_urls)
        GROUP BY "urlId", "deviceType"
      ) device_counts
      GROUP BY "urlId"
    ),
    browsers AS (
      SELECT
        "urlId",
        json_agg(
          json_build_object('label', label, 'count', count)
          ORDER BY count DESC, lower(label), label
        ) AS browsers
      FROM (
        SELECT
          "urlId",
          browser AS label,
          COUNT(*)::int AS count
        FROM "Click"
        WHERE "urlId" IN (SELECT id FROM user_urls)
        GROUP BY "urlId", browser
      ) browser_counts
      GROUP BY "urlId"
    ),
    operating_systems AS (
      SELECT
        "urlId",
        json_agg(
          json_build_object('label', label, 'count', count)
          ORDER BY count DESC, lower(label), label
        ) AS "operatingSystems"
      FROM (
        SELECT
          "urlId",
          os AS label,
          COUNT(*)::int AS count
        FROM "Click"
        WHERE "urlId" IN (SELECT id FROM user_urls)
        GROUP BY "urlId", os
      ) os_counts
      GROUP BY "urlId"
    ),
    referrers AS (
      SELECT
        "urlId",
        json_agg(
          json_build_object('label', label, 'count', count)
          ORDER BY count DESC, lower(label), label
        ) AS referrers
      FROM (
        SELECT
          "urlId",
          referrer AS label,
          COUNT(*)::int AS count
        FROM "Click"
        WHERE "urlId" IN (SELECT id FROM user_urls)
        GROUP BY "urlId", referrer
      ) referrer_counts
      GROUP BY "urlId"
    ),
    countries AS (
      SELECT
        "urlId",
        json_agg(
          json_build_object('label', label, 'count', count)
          ORDER BY count DESC, lower(label), label
        ) AS countries
      FROM (
        SELECT
          "urlId",
          country AS label,
          COUNT(*)::int AS count
        FROM "Click"
        WHERE "urlId" IN (SELECT id FROM user_urls)
        GROUP BY "urlId", country
      ) country_counts
      GROUP BY "urlId"
    )
    SELECT
      u.id,
      u."originalUrl",
      u."shortCode",
      u."createdAt",
      u."expiresAt",
      u.tags,
      u."maxClicks",
      u."hasPassword",
      COALESCE(cs."clickCount", 0) AS "clickCount",
      cs."lastClickedAt",
      COALESCE(d.devices, '[]'::json) AS devices,
      COALESCE(b.browsers, '[]'::json) AS browsers,
      COALESCE(os."operatingSystems", '[]'::json) AS "operatingSystems",
      COALESCE(r.referrers, '[]'::json) AS referrers,
      COALESCE(c.countries, '[]'::json) AS countries
    FROM user_urls u
    LEFT JOIN click_stats cs ON cs."urlId" = u.id
    LEFT JOIN devices d ON d."urlId" = u.id
    LEFT JOIN browsers b ON b."urlId" = u.id
    LEFT JOIN operating_systems os ON os."urlId" = u.id
    LEFT JOIN referrers r ON r."urlId" = u.id
    LEFT JOIN countries c ON c."urlId" = u.id
    ORDER BY u."createdAt" DESC
  `);

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
    analytics: {
      devices: url.devices ?? [],
      browsers: url.browsers ?? [],
      operatingSystems: url.operatingSystems ?? [],
      referrers: url.referrers ?? [],
      countries: url.countries ?? [],
    },
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
