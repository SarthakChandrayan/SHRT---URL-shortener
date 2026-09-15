const MAX_URL_LENGTH = 2048;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export type ParseOriginalUrlResult =
  | { ok: true; href: string }
  | { ok: false; error: string };

export function parseOriginalUrl(value: unknown): ParseOriginalUrlResult {
  if (value === undefined || value === null) {
    return { ok: false, error: "originalUrl is required" };
  }

  if (typeof value !== "string") {
    return { ok: false, error: "originalUrl must be a string" };
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: "originalUrl is required" };
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, error: "originalUrl must be 2048 characters or fewer" };
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "originalUrl is not a valid URL" };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, error: "Only HTTP and HTTPS URLs are supported" };
  }

  if (!url.hostname || /\s/.test(url.hostname)) {
    return { ok: false, error: "originalUrl is not a valid HTTP or HTTPS URL" };
  }

  return { ok: true, href: url.href };
}
