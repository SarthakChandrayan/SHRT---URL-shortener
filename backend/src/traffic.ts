import { createHash, randomBytes } from "node:crypto";

/**
 * Link-preview fetchers (chat apps, social sites), crawlers, uptime monitors,
 * and HTTP libraries. These still get redirected but aren't counted as clicks
 * — otherwise pasting a link into a chat inflates stats and burns click limits.
 * Names like "Pinterest" or "Telegram" alone are deliberately absent: their
 * in-app browsers carry them too, and their bots already match "bot".
 */
const BOT_PATTERN = new RegExp(
  [
    "bot\\b",
    "bot/",
    "crawl",
    "spider",
    "slurp",
    "facebookexternalhit",
    "facebot",
    "embedly",
    "quora link preview",
    "vkshare",
    "whatsapp",
    "slack-imgproxy",
    "skypeuripreview",
    "bingpreview",
    "google-inspectiontool",
    "googleother",
    "mediapartners",
    "feedfetcher",
    "headlesschrome",
    "lighthouse",
    "preview",
    "curl/",
    "wget/",
    "python-",
    "go-http-client",
    "okhttp",
    "java/",
    "axios/",
    "node-fetch",
    "undici",
    "httpclient",
    "postman",
    "insomnia",
    "scrapy",
    "ia_archiver",
    "semrush",
    "ahrefs",
    "bytespider",
    "gptbot",
    "chatgpt-user",
    "claudebot",
    "claude-web",
    "claude-user",
    "perplexity",
    "ccbot",
    "amazonbot",
    "yandex",
    "baiduspider",
    "duckduckbot",
    "petalbot",
    "uptimerobot",
    "pingdom",
    "statuscake",
  ].join("|"),
  "i",
);

export function isBot(userAgent: string | undefined): boolean {
  const ua = userAgent?.trim();
  // Real browsers always send a user agent.
  return !ua || BOT_PATTERN.test(ua);
}

const configuredSalt = process.env.ANALYTICS_SALT?.trim();
const fallbackSalt = randomBytes(32).toString("hex");

if (!configuredSalt) {
  console.warn(
    "ANALYTICS_SALT is not set; unique visitor counts will reset whenever the server restarts.",
  );
}

/**
 * A pseudonymous visitor id: SHA-256 of a secret, today's UTC date, the IP,
 * and the user agent. The date makes it rotate daily, so visitors can't be
 * tracked across days and the IP can't be recovered.
 */
export function visitorHash(ip: string | undefined, userAgent: string | undefined): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${configuredSalt ?? fallbackSalt}|${day}|${ip ?? ""}|${userAgent ?? ""}`)
    .digest("base64url")
    .slice(0, 32);
}

/** Short key for rate limiting by IP + browser, so shared IPs (CGNAT) aren't lumped. */
export function userAgentKey(userAgent: string | undefined): string {
  return createHash("sha1")
    .update(userAgent ?? "")
    .digest("base64url")
    .slice(0, 10);
}

/**
 * Explicit attribution from the visit URL: `?s=qr` is added to every QR code
 * SHRT generates; otherwise the visitor's own `utm_source` / `ref`.
 */
export function visitSource(query: Record<string, unknown>): string | null {
  if (query.s === "qr") {
    return "qr";
  }

  const raw = query.utm_source ?? query.ref;
  if (typeof raw !== "string") {
    return null;
  }

  const value = raw.trim().toLowerCase().slice(0, 64);
  return /^[a-z0-9][a-z0-9._ -]*$/.test(value) ? value : null;
}

const REFERRER_GROUPS: Array<[RegExp, string]> = [
  [/^(mail\.google\.com|inbox\.google\.com)$/, "Gmail"],
  [/^(outlook\.(live|office|office365)\.com)$/, "Outlook"],
  [/^(t\.co|(mobile\.)?twitter\.com|x\.com)$/, "X (Twitter)"],
  [/^((l|lm|m|web)\.)?facebook\.com$|^fb\.me$/, "Facebook"],
  [/^(l\.)?instagram\.com$/, "Instagram"],
  [/^((www|m)\.)?linkedin\.com$|^lnkd\.in$/, "LinkedIn"],
  [/^((m|music)\.)?youtube\.com$|^youtu\.be$/, "YouTube"],
  [/^((old|out|np)\.)?reddit\.com$/, "Reddit"],
  [/^news\.ycombinator\.com$/, "Hacker News"],
  [/^(www\.)?google\.[a-z.]+$/, "Google"],
  [/^(www\.)?bing\.com$/, "Bing"],
  [/^(www\.)?duckduckgo\.com$/, "DuckDuckGo"],
  [/^(web\.whatsapp\.com|wa\.me)$/, "WhatsApp"],
  [/^(t\.me|web\.telegram\.org)$/, "Telegram"],
  [/^(www\.)?discord(app)?\.com$/, "Discord"],
  [/^([a-z0-9-]+\.)?slack\.com$/, "Slack"],
  [/^(www\.)?github\.com$/, "GitHub"],
];

/** Groups a referrer hostname into a recognizable traffic source. */
export function referrerLabel(hostname: string): string {
  if (hostname === "direct") {
    return "Direct";
  }

  if (hostname === "unknown" || !hostname) {
    return "Unidentified";
  }

  for (const [pattern, label] of REFERRER_GROUPS) {
    if (pattern.test(hostname)) {
      return label;
    }
  }

  return hostname.replace(/^www\./, "");
}

/** The single "traffic source" shown for a click: explicit source wins over referrer. */
export function trafficSourceLabel(source: string | null, referrer: string): string {
  if (source === "qr") {
    return "QR code";
  }

  if (source) {
    return `${source} (UTM)`;
  }

  return referrerLabel(referrer);
}
