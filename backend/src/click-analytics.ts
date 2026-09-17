import Bowser from "bowser";
// This product includes GeoLite2 Data created by MaxMind, available from https://www.maxmind.com/.
import geoip from "geoip-country";

const MAX_REFERRER_LENGTH = 253;
const MAX_COUNTRY_LENGTH = 64;
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const CDN_COUNTRY_HEADERS = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "cloudfront-viewer-country",
] as const;
const IGNORED_COUNTRY_CODES = new Set(["XX", "T1", "A1", "A2", "O1"]);

export type DeviceType = "desktop" | "mobile" | "tablet" | "unknown";
export type BrowserName = "Chrome" | "Safari" | "Firefox" | "Edge" | "unknown";
export type OsName =
  | "Windows"
  | "macOS"
  | "Linux"
  | "Android"
  | "iOS"
  | "unknown";

export type ClickAnalytics = {
  deviceType: DeviceType;
  browser: BrowserName;
  os: OsName;
  referrer: string;
  country: string;
};

export type ClickBreakdown = {
  label: string;
  count: number;
};

export type ClickAnalyticsSummary = {
  devices: ClickBreakdown[];
  browsers: ClickBreakdown[];
  operatingSystems: ClickBreakdown[];
  referrers: ClickBreakdown[];
  countries: ClickBreakdown[];
};

export async function parseClickRequest(
  userAgent: string | undefined,
  referer: string | undefined,
  ip: string | undefined,
  getHeader?: (name: string) => string | undefined,
): Promise<ClickAnalytics> {
  const ua = userAgent?.trim() ?? "";
  const parsed = ua ? Bowser.parse(ua) : null;

  return {
    deviceType: mapDevice(ua, parsed?.platform.type),
    browser: mapBrowser(parsed?.browser.name),
    os: mapOs(parsed?.os.name),
    referrer: normalizeReferrer(referer),
    country: await resolveCountry(ip, getHeader),
  };
}

export function summarizeClicks(
  clicks: Array<{
    deviceType: string;
    browser: string;
    os: string;
    referrer: string;
    country: string;
  }>,
): ClickAnalyticsSummary {
  return {
    devices: breakdown(clicks.map((click) => click.deviceType)),
    browsers: breakdown(clicks.map((click) => click.browser)),
    operatingSystems: breakdown(clicks.map((click) => click.os)),
    referrers: breakdown(clicks.map((click) => click.referrer)),
    countries: breakdown(clicks.map((click) => click.country)),
  };
}

function mapDevice(ua: string, type: string | undefined): DeviceType {
  if (!ua) {
    return "unknown";
  }

  if (type === "mobile" || type === "tablet" || type === "desktop") {
    return type;
  }

  return "unknown";
}

function mapBrowser(name: string | undefined): BrowserName {
  if (!name) {
    return "unknown";
  }

  const normalized = name.toLowerCase();

  if (normalized.includes("edg")) {
    return "Edge";
  }

  if (normalized.includes("chrome") || normalized === "chromium") {
    return "Chrome";
  }

  if (normalized.includes("safari")) {
    return "Safari";
  }

  if (normalized.includes("firefox")) {
    return "Firefox";
  }

  return "unknown";
}

function mapOs(name: string | undefined): OsName {
  if (!name) {
    return "unknown";
  }

  const normalized = name.toLowerCase();

  if (normalized.includes("windows")) {
    return "Windows";
  }

  if (normalized.includes("mac os") || normalized === "macos") {
    return "macOS";
  }

  if (normalized === "ios" || normalized === "ipados") {
    return "iOS";
  }

  if (normalized.includes("android")) {
    return "Android";
  }

  if (
    normalized.includes("linux") ||
    normalized === "ubuntu" ||
    normalized === "debian" ||
    normalized === "fedora" ||
    normalized === "gentoo" ||
    normalized === "mint" ||
    normalized === "arch"
  ) {
    return "Linux";
  }

  return "unknown";
}

let publicCountryPromise: Promise<string | null> | null = null;

void countryFromPublicIp();

async function resolveCountry(
  ip: string | undefined,
  getHeader?: (name: string) => string | undefined,
): Promise<string> {
  const fromHeader = countryFromHeaders(getHeader);

  if (fromHeader) {
    return fromHeader;
  }

  const normalizedIp = normalizeIp(ip);

  if (!normalizedIp) {
    return "unknown";
  }

  if (isLoopbackIp(normalizedIp)) {
    return (await countryFromPublicIp()) ?? "local";
  }

  if (isPrivateIp(normalizedIp)) {
    return "local";
  }

  try {
    const lookup = geoip.lookup(normalizedIp);
    const code = lookup?.country?.trim().toUpperCase();

    if (!code || IGNORED_COUNTRY_CODES.has(code)) {
      return "unknown";
    }

    return countryLabel(code);
  } catch {
    return "unknown";
  }
}

function countryFromPublicIp(): Promise<string | null> {
  if (!publicCountryPromise) {
    publicCountryPromise = fetchPublicCountry().catch(() => null);
  }

  return publicCountryPromise;
}

async function fetchPublicCountry(): Promise<string | null> {
  const response = await fetch("https://cloudflare.com/cdn-cgi/trace", {
    signal: AbortSignal.timeout(800),
  });

  if (!response.ok) {
    return null;
  }

  const loc = /^loc=([A-Z]{2})$/m.exec(await response.text())?.[1];

  if (!loc || IGNORED_COUNTRY_CODES.has(loc)) {
    return null;
  }

  return countryLabel(loc);
}

function countryFromHeaders(
  getHeader?: (name: string) => string | undefined,
): string | null {
  if (!getHeader) {
    return null;
  }

  for (const header of CDN_COUNTRY_HEADERS) {
    const value = getHeader(header)?.trim().toUpperCase();

    if (value && /^[A-Z]{2}$/.test(value) && !IGNORED_COUNTRY_CODES.has(value)) {
      return countryLabel(value);
    }
  }

  return null;
}

function countryLabel(code: string): string {
  try {
    const name = countryNames.of(code);

    if (name && name !== code) {
      return name.slice(0, MAX_COUNTRY_LENGTH);
    }
  } catch {
    // Intl.DisplayNames throws on some invalid region codes.
  }

  return code;
}

function normalizeIp(ip: string | undefined): string | undefined {
  const value = ip?.trim();

  if (!value) {
    return undefined;
  }

  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length);
  }

  return value;
}

function isLoopbackIp(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1";
}

function isPrivateIp(ip: string): boolean {
  if (isLoopbackIp(ip) || ip === "0.0.0.0" || ip === "::") {
    return true;
  }

  if (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("169.254.")
  ) {
    return true;
  }

  const match = /^172\.(\d+)\./.exec(ip);

  if (match) {
    const octet = Number(match[1]);
    if (octet >= 16 && octet <= 31) {
      return true;
    }
  }

  const lower = ip.toLowerCase();
  return (
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:")
  );
}

function normalizeReferrer(referer: string | undefined): string {
  const value = referer?.trim();

  if (!value) {
    return "direct";
  }

  try {
    const hostname = new URL(value).hostname.toLowerCase();

    if (!hostname) {
      return "direct";
    }

    return hostname.slice(0, MAX_REFERRER_LENGTH);
  } catch {
    return "unknown";
  }
}

function breakdown(values: string[]): ClickBreakdown[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
