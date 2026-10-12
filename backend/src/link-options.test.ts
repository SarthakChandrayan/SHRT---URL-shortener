import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLinkPassword, parseMaxClicks, parseTags } from "./link-options.js";
import {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  hashLinkPassword,
  verifyLinkPassword,
} from "./secrets.js";

describe("parseTags", () => {
  it("normalizes, lowercases, and de-duplicates", () => {
    assert.deepEqual(parseTags(["  Marketing ", "marketing", "Q4  launch", ""]), {
      ok: true,
      value: ["marketing", "q4 launch"],
    });
  });

  it("treats missing values as no tags", () => {
    assert.deepEqual(parseTags(undefined), { ok: true, value: [] });
    assert.deepEqual(parseTags(null), { ok: true, value: [] });
  });

  it("rejects bad shapes, characters, lengths, and counts", () => {
    assert.equal(parseTags("marketing").ok, false);
    assert.equal(parseTags([1, 2]).ok, false);
    assert.equal(parseTags(["<script>"]).ok, false);
    assert.equal(parseTags(["a".repeat(25)]).ok, false);
    assert.equal(parseTags(Array.from({ length: 11 }, (_, i) => `t${i}`)).ok, false);
  });
});

describe("parseLinkPassword", () => {
  it("treats empty values as no password", () => {
    for (const value of [undefined, null, ""]) {
      assert.deepEqual(parseLinkPassword(value), { ok: true, value: null });
    }
  });

  it("enforces type and length", () => {
    assert.equal(parseLinkPassword(1234).ok, false);
    assert.equal(parseLinkPassword("abc").ok, false);
    assert.equal(parseLinkPassword("a".repeat(129)).ok, false);
    assert.deepEqual(parseLinkPassword("open sesame"), { ok: true, value: "open sesame" });
  });
});

describe("parseMaxClicks", () => {
  it("accepts positive integers, including numeric strings", () => {
    assert.deepEqual(parseMaxClicks(100), { ok: true, value: 100 });
    assert.deepEqual(parseMaxClicks("5"), { ok: true, value: 5 });
  });

  it("treats empty values as unlimited", () => {
    assert.deepEqual(parseMaxClicks(null), { ok: true, value: null });
    assert.deepEqual(parseMaxClicks(""), { ok: true, value: null });
  });

  it("rejects zero, negatives, fractions, and junk", () => {
    for (const value of [0, -1, 1.5, "abc", true, 2e9]) {
      assert.equal(parseMaxClicks(value).ok, false, String(value));
    }
  });
});

describe("link passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashLinkPassword("correct horse");
    assert.match(stored, /^scrypt\$/);
    assert.equal(await verifyLinkPassword("correct horse", stored), true);
    assert.equal(await verifyLinkPassword("wrong horse", stored), false);
  });

  it("salts each hash", async () => {
    assert.notEqual(await hashLinkPassword("same"), await hashLinkPassword("same"));
  });

  it("rejects malformed stored hashes", async () => {
    assert.equal(await verifyLinkPassword("x", "plaintext"), false);
  });
});

describe("API keys", () => {
  it("generates prefixed keys whose hash matches", () => {
    const { key, prefix, hash } = generateApiKey();
    assert.ok(key.startsWith(API_KEY_PREFIX));
    assert.ok(key.startsWith(prefix));
    assert.equal(hashApiKey(key), hash);
    assert.notEqual(generateApiKey().key, key);
  });
});
