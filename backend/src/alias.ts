export const ALIAS_MIN_LENGTH = 3;
export const ALIAS_MAX_LENGTH = 32;

const ALIAS_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Any code we'll ever serve at `/:shortCode` (generated or custom). */
export const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Paths the frontend or API already use, plus names likely to be mistaken
 * for official pages. Compared case-insensitively.
 */
const RESERVED_ALIASES = new Set([
  "about",
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "dashboard",
  "favicon",
  "health",
  "help",
  "index",
  "login",
  "logout",
  "privacy",
  "profile",
  "robots",
  "settings",
  "signin",
  "signout",
  "signup",
  "sitemap",
  "static",
  "support",
  "terms",
  "www",
]);

export type ParseAliasResult =
  | { ok: true; alias: string | null }
  | { ok: false; error: string };

/** `undefined`, `null`, or blank means "generate a random code". */
export function parseAlias(value: unknown): ParseAliasResult {
  if (value === undefined || value === null) {
    return { ok: true, alias: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: "alias must be a string" };
  }

  const alias = value.trim();

  if (alias.length === 0) {
    return { ok: true, alias: null };
  }

  if (alias.length < ALIAS_MIN_LENGTH || alias.length > ALIAS_MAX_LENGTH) {
    return {
      ok: false,
      error: `Alias must be ${ALIAS_MIN_LENGTH}–${ALIAS_MAX_LENGTH} characters`,
    };
  }

  if (!ALIAS_PATTERN.test(alias)) {
    return {
      ok: false,
      error: "Alias can only use letters, numbers, hyphens and underscores",
    };
  }

  if (RESERVED_ALIASES.has(alias.toLowerCase())) {
    return { ok: false, error: "That alias is reserved" };
  }

  return { ok: true, alias };
}
