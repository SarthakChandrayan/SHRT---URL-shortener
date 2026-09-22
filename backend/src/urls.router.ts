import { Prisma } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "./auth.js";
import type { ClickBreakdown } from "./click-analytics.js";
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
        "expiresAt"
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
