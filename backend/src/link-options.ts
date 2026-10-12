export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 24;
export const LINK_PASSWORD_MIN = 4;
export const LINK_PASSWORD_MAX = 128;
export const MAX_CLICKS_LIMIT = 1_000_000_000;

const TAG_PATTERN = /^[a-z0-9][a-z0-9 _-]*$/;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Tags are lowercased, trimmed, and de-duplicated. `undefined`/`null` means
 * "no tags". Each tag is 1–24 letters, digits, spaces, hyphens, or underscores.
 */
export function parseTags(value: unknown): Parsed<string[]> {
  if (value === undefined || value === null) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string")) {
    return { ok: false, error: "tags must be an array of strings" };
  }

  const tags = [
    ...new Set(
      value
        .map((tag: string) => tag.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  ];

  if (tags.length > MAX_TAGS) {
    return { ok: false, error: `Use ${MAX_TAGS} tags or fewer` };
  }

  for (const tag of tags) {
    if (tag.length > MAX_TAG_LENGTH || !TAG_PATTERN.test(tag)) {
      return {
        ok: false,
        error: `Tags must be 1–${MAX_TAG_LENGTH} letters, numbers, spaces, hyphens or underscores`,
      };
    }
  }

  return { ok: true, value: tags };
}

/** `undefined`/`null`/blank means "no password". */
export function parseLinkPassword(value: unknown): Parsed<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: "password must be a string" };
  }

  if (value.length < LINK_PASSWORD_MIN || value.length > LINK_PASSWORD_MAX) {
    return {
      ok: false,
      error: `Link password must be ${LINK_PASSWORD_MIN}–${LINK_PASSWORD_MAX} characters`,
    };
  }

  return { ok: true, value };
}

/** `undefined`/`null`/blank means "unlimited". */
export function parseMaxClicks(value: unknown): Parsed<number | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }

  const number = typeof value === "string" ? Number(value) : value;

  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 1 ||
    number > MAX_CLICKS_LIMIT
  ) {
    return { ok: false, error: "Click limit must be a whole number of 1 or more" };
  }

  return { ok: true, value: number };
}
