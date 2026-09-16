import Bowser from "bowser";

const MAX_REFERRER_LENGTH = 253;

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
};

export function parseClickRequest(
  userAgent: string | undefined,
  referer: string | undefined,
): ClickAnalytics {
  const ua = userAgent?.trim() ?? "";
  const parsed = ua ? Bowser.parse(ua) : null;

  return {
    deviceType: mapDevice(ua, parsed?.platform.type),
    browser: mapBrowser(parsed?.browser.name),
    os: mapOs(parsed?.os.name),
    referrer: normalizeReferrer(referer),
  };
}

export function summarizeClicks(
  clicks: Array<{
    deviceType: string;
    browser: string;
    os: string;
    referrer: string;
  }>,
): ClickAnalyticsSummary {
  return {
    devices: breakdown(clicks.map((click) => click.deviceType)),
    browsers: breakdown(clicks.map((click) => click.browser)),
    operatingSystems: breakdown(clicks.map((click) => click.os)),
    referrers: breakdown(clicks.map((click) => click.referrer)),
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
