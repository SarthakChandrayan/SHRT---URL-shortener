export type ParseExpiresAtResult =
  | { ok: true; expiresAt: Date | null }
  | { ok: false; error: string };

/**
 * `undefined`, `null`, or blank means the URL never expires.
 * Any other value must be a parseable date strictly in the future.
 */
export function parseExpiresAt(value: unknown): ParseExpiresAtResult {
  if (value === undefined || value === null) {
    return { ok: true, expiresAt: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: "expiresAt must be a date string or null" };
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return { ok: true, expiresAt: null };
  }

  const ms = Date.parse(trimmed);

  if (Number.isNaN(ms)) {
    return { ok: false, error: "expiresAt is not a valid date" };
  }

  if (ms <= Date.now()) {
    return { ok: false, error: "expiresAt must be in the future" };
  }

  return { ok: true, expiresAt: new Date(ms) };
}
