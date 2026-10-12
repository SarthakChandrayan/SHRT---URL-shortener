import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { trafficSourceLabel } from "./traffic.js";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DEFAULT_RANGE_DAYS = 7;
export const MAX_RANGE_DAYS = 90;

export type AnalyticsRange = {
  startDate: string;
  endDate: string;
  timezone: string;
  days: number;
};

type ParsedRange = { ok: true; range: AnalyticsRange } | { ok: false; error: string };

/** Accepts IANA zones (e.g. "Asia/Kolkata") that both Intl and Postgres know. */
export function parseTimezone(value: unknown): string | null {
  if (value === undefined || value === "") {
    return "UTC";
  }

  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) {
    return null;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** Today's date (YYYY-MM-DD) as seen in `timezone`. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function parseIsoDay(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = ISO_DAY.exec(value.trim());
  if (!match) {
    return null;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
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

export function addDays(isoDay: string, days: number): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDays(startDate: string, endDate: string): number {
  return (
    Math.round(
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
    ) + 1
  );
}

/**
 * Parses `startDate`, `endDate` (YYYY-MM-DD, inclusive) and `tz`. Days are
 * calendar days in that timezone; the default is the last 7 days ending today.
 */
export function parseAnalyticsRange(query: Record<string, unknown>): ParsedRange {
  if ([query.startDate, query.endDate, query.tz].some(Array.isArray)) {
    return { ok: false, error: "startDate, endDate and tz may only be given once" };
  }

  const timezone = parseTimezone(query.tz);
  if (!timezone) {
    return { ok: false, error: "tz must be an IANA timezone like Asia/Kolkata" };
  }

  let endDate = todayIn(timezone);
  if (query.endDate !== undefined && query.endDate !== "") {
    const parsed = parseIsoDay(query.endDate);
    if (!parsed) {
      return { ok: false, error: "endDate must be YYYY-MM-DD" };
    }
    endDate = parsed;
  }

  let startDate = addDays(endDate, -(DEFAULT_RANGE_DAYS - 1));
  if (query.startDate !== undefined && query.startDate !== "") {
    const parsed = parseIsoDay(query.startDate);
    if (!parsed) {
      return { ok: false, error: "startDate must be YYYY-MM-DD" };
    }
    startDate = parsed;
  }

  if (startDate > endDate) {
    return { ok: false, error: "startDate must be on or before endDate" };
  }

  const days = inclusiveDays(startDate, endDate);
  if (days > MAX_RANGE_DAYS) {
    return { ok: false, error: `Date range must be ${MAX_RANGE_DAYS} days or fewer` };
  }

  return { ok: true, range: { startDate, endDate, timezone, days } };
}

export type Scope = { kind: "url"; urlId: string } | { kind: "user"; userId: string };

function scopeFilter(scope: Scope): Prisma.Sql {
  return scope.kind === "url"
    ? Prisma.sql`c."urlId" = ${scope.urlId}`
    : Prisma.sql`c."urlId" IN (SELECT id FROM "Url" WHERE "userId" = ${scope.userId})`;
}

/**
 * `clickedAt` is stored as UTC without a zone. These bounds turn local
 * midnights in `tz` into naive UTC timestamps, so the (urlId, clickedAt)
 * index still applies.
 */
export function windowFilter(startDate: string, endDate: string, tz: string): Prisma.Sql {
  return Prisma.sql`
    c."clickedAt" >= ((${startDate}::date)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'
    AND c."clickedAt" < ((${endDate}::date + 1)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'
  `;
}

export function localTime(tz: string): Prisma.Sql {
  return Prisma.sql`(c."clickedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})`;
}

// Clicks recorded before visitor hashing existed count as one visitor each.
const VISITOR = Prisma.sql`COALESCE(c."visitorHash", c.id)`;

export function buildTotalsQuery(scope: Scope, start: string, end: string, tz: string) {
  return Prisma.sql`
    SELECT COUNT(*)::int AS clicks, COUNT(DISTINCT ${VISITOR})::int AS visitors
    FROM "Click" c
    WHERE ${scopeFilter(scope)} AND ${windowFilter(start, end, tz)}
  `;
}

export function buildSeriesQuery(scope: Scope, range: AnalyticsRange) {
  const { startDate, endDate, timezone } = range;
  return Prisma.sql`
    WITH days AS (
      SELECT generate_series(${startDate}::date, ${endDate}::date, INTERVAL '1 day')::date AS day
    ),
    counts AS (
      SELECT
        ${localTime(timezone)}::date AS day,
        COUNT(*)::int AS clicks,
        COUNT(DISTINCT ${VISITOR})::int AS visitors
      FROM "Click" c
      WHERE ${scopeFilter(scope)} AND ${windowFilter(startDate, endDate, timezone)}
      GROUP BY 1
    )
    SELECT
      to_char(days.day, 'YYYY-MM-DD') AS date,
      COALESCE(counts.clicks, 0)::int AS clicks,
      COALESCE(counts.visitors, 0)::int AS visitors
    FROM days
    LEFT JOIN counts ON counts.day = days.day
    ORDER BY days.day
  `;
}

/** One scan, five breakdowns, via GROUPING SETS. */
export function buildBreakdownQuery(scope: Scope, range: AnalyticsRange) {
  const { startDate, endDate, timezone } = range;
  return Prisma.sql`
    SELECT
      CASE
        WHEN GROUPING(c."deviceType") = 0 THEN 'device'
        WHEN GROUPING(c.browser) = 0 THEN 'browser'
        WHEN GROUPING(c.os) = 0 THEN 'os'
        WHEN GROUPING(c.country) = 0 THEN 'country'
        ELSE 'source'
      END AS dimension,
      c."deviceType" AS device,
      c.browser,
      c.os,
      c.country,
      c.source,
      c.referrer,
      COUNT(*)::int AS clicks
    FROM "Click" c
    WHERE ${scopeFilter(scope)} AND ${windowFilter(startDate, endDate, timezone)}
    GROUP BY GROUPING SETS ((c."deviceType"), (c.browser), (c.os), (c.country), (c.source, c.referrer))
  `;
}

/** Clicks by local weekday (0 = Monday) and hour. */
export function buildHeatmapQuery(scope: Scope, range: AnalyticsRange) {
  const { startDate, endDate, timezone } = range;
  return Prisma.sql`
    SELECT
      (EXTRACT(ISODOW FROM ${localTime(timezone)})::int - 1) AS day,
      EXTRACT(HOUR FROM ${localTime(timezone)})::int AS hour,
      COUNT(*)::int AS clicks
    FROM "Click" c
    WHERE ${scopeFilter(scope)} AND ${windowFilter(startDate, endDate, timezone)}
    GROUP BY 1, 2
  `;
}

export function buildTopLinksQuery(userId: string, range: AnalyticsRange, limit = 8) {
  const { startDate, endDate, timezone } = range;
  return Prisma.sql`
    SELECT
      u.id,
      u."shortCode",
      u."originalUrl",
      COUNT(*)::int AS clicks,
      COUNT(DISTINCT ${VISITOR})::int AS visitors
    FROM "Click" c
    JOIN "Url" u ON u.id = c."urlId"
    WHERE u."userId" = ${userId} AND ${windowFilter(startDate, endDate, timezone)}
    GROUP BY u.id, u."shortCode", u."originalUrl"
    ORDER BY clicks DESC, u."shortCode"
    LIMIT ${limit}
  `;
}

export type Breakdown = { label: string; count: number };

type BreakdownRow = {
  dimension: "device" | "browser" | "os" | "country" | "source";
  device: string | null;
  browser: string | null;
  os: string | null;
  country: string | null;
  source: string | null;
  referrer: string | null;
  clicks: number;
};

const DEVICE_ORDER = ["desktop", "mobile", "tablet", "unknown"];

/** Turns grouping-set rows into sorted lists; sources merge by display label. */
export function shapeBreakdowns(rows: BreakdownRow[]) {
  const buckets: Record<BreakdownRow["dimension"], Map<string, number>> = {
    device: new Map(),
    browser: new Map(),
    os: new Map(),
    country: new Map(),
    source: new Map(),
  };

  for (const row of rows) {
    const label =
      row.dimension === "source"
        ? trafficSourceLabel(row.source, row.referrer ?? "direct")
        : row.dimension === "device"
          ? DEVICE_ORDER.includes(row.device ?? "") ? row.device! : "unknown"
          : (row[row.dimension] ?? "unknown");
    const bucket = buckets[row.dimension];
    bucket.set(label, (bucket.get(label) ?? 0) + Number(row.clicks));
  }

  const sorted = (map: Map<string, number>): Breakdown[] =>
    [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    devices: sorted(buckets.device),
    browsers: sorted(buckets.browser),
    operatingSystems: sorted(buckets.os),
    countries: sorted(buckets.country),
    sources: sorted(buckets.source),
  };
}

type Totals = { clicks: number; visitors: number };

export async function getAnalytics(scope: Scope, range: AnalyticsRange) {
  const previousEnd = addDays(range.startDate, -1);
  const previousStart = addDays(previousEnd, -(range.days - 1));

  const [[current], [previous], series, breakdownRows, heatmap] = await Promise.all([
    prisma.$queryRaw<Totals[]>(buildTotalsQuery(scope, range.startDate, range.endDate, range.timezone)),
    prisma.$queryRaw<Totals[]>(buildTotalsQuery(scope, previousStart, previousEnd, range.timezone)),
    prisma.$queryRaw<Array<{ date: string; clicks: number; visitors: number }>>(
      buildSeriesQuery(scope, range),
    ),
    prisma.$queryRaw<BreakdownRow[]>(buildBreakdownQuery(scope, range)),
    prisma.$queryRaw<Array<{ day: number; hour: number; clicks: number }>>(
      buildHeatmapQuery(scope, range),
    ),
  ]);

  return {
    startDate: range.startDate,
    endDate: range.endDate,
    timezone: range.timezone,
    totals: { clicks: Number(current.clicks), visitors: Number(current.visitors) },
    previous: {
      startDate: previousStart,
      endDate: previousEnd,
      clicks: Number(previous.clicks),
      visitors: Number(previous.visitors),
    },
    series: series.map((row) => ({
      date: row.date,
      clicks: Number(row.clicks),
      visitors: Number(row.visitors),
    })),
    breakdowns: shapeBreakdowns(breakdownRows),
    heatmap: heatmap.map((row) => ({
      day: Number(row.day),
      hour: Number(row.hour),
      clicks: Number(row.clicks),
    })),
  };
}

export async function getOverview(userId: string, range: AnalyticsRange) {
  const [analytics, topLinks, linkCounts] = await Promise.all([
    getAnalytics({ kind: "user", userId }, range),
    prisma.$queryRaw<
      Array<{ id: string; shortCode: string; originalUrl: string; clicks: number; visitors: number }>
    >(buildTopLinksQuery(userId, range)),
    prisma.$queryRaw<Array<{ total: number; created: number }>>(Prisma.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE "createdAt" >= ((${range.startDate}::date)::timestamp AT TIME ZONE ${range.timezone}) AT TIME ZONE 'UTC'
        )::int AS created
      FROM "Url"
      WHERE "userId" = ${userId}
    `),
  ]);

  return {
    ...analytics,
    links: {
      total: Number(linkCounts[0]?.total ?? 0),
      createdInRange: Number(linkCounts[0]?.created ?? 0),
    },
    topLinks: topLinks.map((link) => ({
      ...link,
      clicks: Number(link.clicks),
      visitors: Number(link.visitors),
    })),
  };
}

/** Every link with settings, all-time totals, and a daily sparkline for [start, end]. */
export function buildLinkListQuery(userId: string, startDate: string, endDate: string, timezone: string) {
  return Prisma.sql`
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
    recent AS (
      SELECT c."urlId", ${localTime(timezone)}::date AS day, COUNT(*)::int AS clicks
      FROM "Click" c
      WHERE c."urlId" IN (SELECT id FROM user_urls)
        AND ${windowFilter(startDate, endDate, timezone)}
      GROUP BY 1, 2
    ),
    sparklines AS (
      SELECT
        u.id AS "urlId",
        json_agg(COALESCE(r.clicks, 0) ORDER BY d.day) AS "recentClicks"
      FROM user_urls u
      CROSS JOIN generate_series(${startDate}::date, ${endDate}::date, INTERVAL '1 day') AS d(day)
      LEFT JOIN recent r ON r."urlId" = u.id AND r.day = d.day::date
      GROUP BY u.id
    )
    SELECT
      u.*,
      COALESCE(cs."clickCount", 0) AS "clickCount",
      cs."lastClickedAt",
      s."recentClicks"
    FROM user_urls u
    LEFT JOIN click_stats cs ON cs."urlId" = u.id
    LEFT JOIN sparklines s ON s."urlId" = u.id
    ORDER BY u."createdAt" DESC
  `;
}
