import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import {
  buildBreakdownQuery,
  buildHeatmapQuery,
  buildLinkListQuery,
  buildSeriesQuery,
  buildTopLinksQuery,
  buildTotalsQuery,
  parseAnalyticsRange,
  parseTimezone,
  shapeBreakdowns,
  type AnalyticsRange,
} from "./analytics.js";
import { isBot, referrerLabel, trafficSourceLabel, visitSource } from "./traffic.js";

// Runs the real analytics SQL on an in-memory Postgres (PGlite) built from
// the project's own migrations — no database connection needed.
let db: PGlite;

async function run<T>(query: Prisma.Sql): Promise<T[]> {
  const result = await db.query<T>(query.text, query.values as unknown[]);
  return result.rows;
}

const IST: AnalyticsRange = {
  startDate: "2026-10-05",
  endDate: "2026-10-06",
  timezone: "Asia/Kolkata",
  days: 2,
};

before(async () => {
  db = new PGlite();
  const migrations = path.join(import.meta.dirname, "..", "prisma", "migrations");
  for (const dir of readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
    await db.exec(readFileSync(path.join(migrations, dir, "migration.sql"), "utf8"));
  }

  await db.exec(`
    INSERT INTO "Url" (id, "originalUrl", "shortCode", "userId") VALUES
      ('u1', 'https://a.example', 'aaa', 'me'),
      ('u2', 'https://b.example', 'bbb', 'me'),
      ('u3', 'https://c.example', 'ccc', 'someone-else');

    INSERT INTO "Click" (id, "urlId", "clickedAt", "deviceType", browser, os, referrer, country, "visitorHash", source) VALUES
      -- 2026-10-05 22:30 IST (17:00 UTC): Oct 5 locally
      ('c1', 'u1', '2026-10-05 17:00:00', 'mobile',  'Chrome', 'Android', 't.co',        'India', 'v1', NULL),
      -- 2026-10-06 01:30 IST (Oct 5 20:00 UTC): Oct 6 locally, though Oct 5 in UTC
      ('c2', 'u1', '2026-10-05 20:00:00', 'mobile',  'Chrome', 'Android', 'x.com',       'India', 'v1', NULL),
      ('c3', 'u1', '2026-10-06 04:00:00', 'desktop', 'Safari', 'macOS',   'direct',      'India', 'v2', 'qr'),
      ('c4', 'u2', '2026-10-06 05:00:00', 'desktop', 'Firefox','Windows', 'direct',      'United States', NULL, 'newsletter'),
      ('c5', 'u2', '2026-10-06 05:30:00', 'desktop', 'Firefox','Windows', 'google.co.in','United States', NULL, NULL),
      -- Before the range (Oct 4 IST) — previous period
      ('c6', 'u1', '2026-10-04 10:00:00', 'tablet',  'Safari', 'iOS',     'direct',      'India', 'v9', NULL),
      -- Another user's link: never counted for "me"
      ('c7', 'u3', '2026-10-06 06:00:00', 'desktop', 'Chrome', 'Windows', 'direct',      'India', 'v7', NULL);
  `);
});

after(async () => {
  await db.close();
});

describe("analytics SQL", () => {
  const me = { kind: "user" as const, userId: "me" };

  it("counts clicks and unique visitors in the local-time window", async () => {
    const [totals] = await run<{ clicks: number; visitors: number }>(
      buildTotalsQuery(me, IST.startDate, IST.endDate, IST.timezone),
    );
    // c1..c5; v1 twice → 1, v2, and two unhashed clicks count separately.
    assert.deepEqual(totals, { clicks: 5, visitors: 4 });

    const [previous] = await run<{ clicks: number }>(
      buildTotalsQuery(me, "2026-10-03", "2026-10-04", IST.timezone),
    );
    assert.equal(previous.clicks, 1);
  });

  it("assigns clicks to days in the viewer's timezone", async () => {
    const ist = await run<{ date: string; clicks: number; visitors: number }>(
      buildSeriesQuery(me, IST),
    );
    assert.deepEqual(ist, [
      { date: "2026-10-05", clicks: 1, visitors: 1 },
      { date: "2026-10-06", clicks: 4, visitors: 4 },
    ]);

    const utc = await run<{ date: string; clicks: number }>(
      buildSeriesQuery(me, { ...IST, timezone: "UTC" }),
    );
    assert.deepEqual(
      utc.map((row) => [row.date, row.clicks]),
      [
        ["2026-10-05", 2],
        ["2026-10-06", 3],
      ],
    );
  });

  it("scopes to a single link", async () => {
    const [totals] = await run<{ clicks: number }>(
      buildTotalsQuery({ kind: "url", urlId: "u2" }, IST.startDate, IST.endDate, IST.timezone),
    );
    assert.equal(totals.clicks, 2);
  });

  it("builds range-scoped breakdowns and merges traffic sources", async () => {
    const breakdowns = shapeBreakdowns(await run(buildBreakdownQuery(me, IST)));

    assert.deepEqual(breakdowns.devices, [
      { label: "desktop", count: 3 },
      { label: "mobile", count: 2 },
    ]);
    assert.deepEqual(breakdowns.countries, [
      { label: "India", count: 3 },
      { label: "United States", count: 2 },
    ]);
    assert.deepEqual(breakdowns.sources, [
      { label: "X (Twitter)", count: 2 },
      { label: "Google", count: 1 },
      { label: "newsletter (UTM)", count: 1 },
      { label: "QR code", count: 1 },
    ]);
  });

  it("buckets the heatmap by local weekday and hour", async () => {
    const cells = await run<{ day: number; hour: number; clicks: number }>(
      buildHeatmapQuery({ kind: "url", urlId: "u1" }, IST),
    );
    const key = (cell: { day: number; hour: number }) => `${cell.day}:${cell.hour}`;
    // Oct 5 2026 is a Monday (0); Oct 6 a Tuesday (1).
    assert.deepEqual(cells.map(key).sort(), ["0:22", "1:1", "1:9"]);
  });

  it("lists links with all-time totals and a local-day sparkline", async () => {
    const rows = await run<{ shortCode: string; clickCount: number; recentClicks: number[] }>(
      buildLinkListQuery("me", "2026-10-04", "2026-10-06", "Asia/Kolkata"),
    );
    const byCode = Object.fromEntries(rows.map((row) => [row.shortCode, row]));

    assert.equal(rows.length, 2);
    assert.equal(byCode.aaa.clickCount, 4);
    assert.deepEqual(byCode.aaa.recentClicks, [1, 1, 2]);
    assert.deepEqual(byCode.bbb.recentClicks, [0, 0, 2]);
  });

  it("ranks top links for the user only", async () => {
    const top = await run<{ shortCode: string; clicks: number; visitors: number }>(
      buildTopLinksQuery("me", IST),
    );
    assert.deepEqual(
      top.map((link) => [link.shortCode, link.clicks, link.visitors]),
      [
        ["aaa", 3, 2],
        ["bbb", 2, 2],
      ],
    );
  });
});

describe("parseAnalyticsRange", () => {
  it("defaults to the last 7 days in the given timezone", () => {
    const result = parseAnalyticsRange({ tz: "Asia/Kolkata" });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.range.days, 7);
    assert.equal(result.ok && result.range.timezone, "Asia/Kolkata");
  });

  it("validates dates, order, length, and timezone", () => {
    assert.equal(parseAnalyticsRange({ startDate: "2026-02-30" }).ok, false);
    assert.equal(parseAnalyticsRange({ startDate: "2026-10-09", endDate: "2026-10-01" }).ok, false);
    assert.equal(parseAnalyticsRange({ startDate: "2026-01-01", endDate: "2026-10-01" }).ok, false);
    assert.equal(parseAnalyticsRange({ tz: "Mars/Olympus" }).ok, false);
    assert.equal(parseAnalyticsRange({ tz: "'; DROP TABLE" }).ok, false);
    assert.equal(parseTimezone("UTC"), "UTC");
  });
});

describe("traffic classification", () => {
  it("flags bots, preview fetchers, and missing user agents", () => {
    for (const ua of [
      undefined,
      "",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "WhatsApp/2.23.20.0 A",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "TelegramBot (like TwitterBot)",
      "Twitterbot/1.0",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "curl/8.4.0",
      "python-requests/2.31.0",
    ]) {
      assert.equal(isBot(ua), true, String(ua));
    }
  });

  it("lets real browsers through, including in-app browsers", () => {
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]",
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Instagram 350.0",
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Telegram-Android/11.0",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]",
    ]) {
      assert.equal(isBot(ua), false, ua);
    }
  });

  it("reads QR and UTM attribution from the visit URL", () => {
    assert.equal(visitSource({ s: "qr" }), "qr");
    assert.equal(visitSource({ utm_source: " Newsletter " }), "newsletter");
    assert.equal(visitSource({ ref: "producthunt" }), "producthunt");
    assert.equal(visitSource({ utm_source: "<script>" }), null);
    assert.equal(visitSource({}), null);
  });

  it("groups referrer hostnames into named sources", () => {
    assert.equal(referrerLabel("t.co"), "X (Twitter)");
    assert.equal(referrerLabel("l.facebook.com"), "Facebook");
    assert.equal(referrerLabel("www.google.co.in"), "Google");
    assert.equal(referrerLabel("mail.google.com"), "Gmail");
    assert.equal(referrerLabel("www.example.org"), "example.org");
    assert.equal(referrerLabel("direct"), "Direct");
    assert.equal(trafficSourceLabel("qr", "direct"), "QR code");
  });
});
