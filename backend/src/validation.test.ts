import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAlias, SHORT_CODE_PATTERN } from "./alias.js";
import { parseExpiresAt } from "./expires-at.js";
import { parseOriginalUrl } from "./original-url.js";
import { generateShortCode } from "./short-code.js";

describe("parseOriginalUrl", () => {
  it("accepts http and https URLs and normalizes them", () => {
    assert.deepEqual(parseOriginalUrl("  https://Example.com/a?b=1 "), {
      ok: true,
      href: "https://example.com/a?b=1",
    });
    assert.equal(parseOriginalUrl("http://localhost:8080").ok, true);
  });

  it("rejects missing, non-string, and blank values", () => {
    assert.equal(parseOriginalUrl(undefined).ok, false);
    assert.equal(parseOriginalUrl(42).ok, false);
    assert.equal(parseOriginalUrl("   ").ok, false);
  });

  it("rejects other protocols", () => {
    for (const value of ["javascript:alert(1)", "ftp://x.com", "data:text/html,hi"]) {
      assert.equal(parseOriginalUrl(value).ok, false, value);
    }
  });

  it("rejects URLs over 2048 characters", () => {
    const long = `https://example.com/${"a".repeat(2048)}`;
    assert.equal(parseOriginalUrl(long).ok, false);
  });
});

describe("parseExpiresAt", () => {
  it("treats empty values as never expiring", () => {
    for (const value of [undefined, null, "", "  "]) {
      assert.deepEqual(parseExpiresAt(value), { ok: true, expiresAt: null });
    }
  });

  it("accepts future dates", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = parseExpiresAt(future);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.expiresAt?.toISOString(), future);
  });

  it("rejects past, invalid, and non-string dates", () => {
    assert.equal(parseExpiresAt(new Date(Date.now() - 1000).toISOString()).ok, false);
    assert.equal(parseExpiresAt("not a date").ok, false);
    assert.equal(parseExpiresAt(123).ok, false);
  });
});

describe("parseAlias", () => {
  it("treats empty values as no alias", () => {
    for (const value of [undefined, null, "", "   "]) {
      assert.deepEqual(parseAlias(value), { ok: true, alias: null });
    }
  });

  it("accepts letters, digits, hyphens, and underscores", () => {
    assert.deepEqual(parseAlias(" My_launch-2026 "), {
      ok: true,
      alias: "My_launch-2026",
    });
  });

  it("enforces length limits", () => {
    assert.equal(parseAlias("ab").ok, false);
    assert.equal(parseAlias("a".repeat(33)).ok, false);
    assert.equal(parseAlias("abc").ok, true);
  });

  it("rejects unsafe characters", () => {
    for (const value of ["has space", "slash/es", "dot.dot", "emoji🙂", "../up"]) {
      assert.equal(parseAlias(value).ok, false, value);
    }
  });

  it("rejects reserved paths case-insensitively", () => {
    assert.equal(parseAlias("dashboard").ok, false);
    assert.equal(parseAlias("API").ok, false);
    assert.equal(parseAlias("Health").ok, false);
  });
});

describe("generateShortCode", () => {
  it("produces 7-character codes servable as short links", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateShortCode();
      assert.equal(code.length, 7);
      assert.match(code, SHORT_CODE_PATTERN);
    }
  });
});
