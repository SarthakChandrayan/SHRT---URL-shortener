import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;

/** Hashes a link password as `scrypt$<salt>$<hash>` (base64url). */
export async function hashLinkPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyLinkPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltText, hashText] = stored.split("$");

  if (scheme !== "scrypt" || !saltText || !hashText) {
    return false;
  }

  const expected = Buffer.from(hashText, "base64url");
  const actual = await scrypt(password, Buffer.from(saltText, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const API_KEY_PREFIX = "shrt_";

/**
 * API keys look like `shrt_<8-char id>_<secret>`. Only a SHA-256 hash is
 * stored (keys are high-entropy, so a slow hash isn't needed); the short id
 * is kept in clear so users can tell their keys apart.
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const id = randomBytes(6).toString("base64url");
  const secret = randomBytes(24).toString("base64url");
  const key = `${API_KEY_PREFIX}${id}_${secret}`;
  return { key, prefix: `${API_KEY_PREFIX}${id}`, hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
