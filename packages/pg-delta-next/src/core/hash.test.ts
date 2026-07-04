import { describe, expect, test } from "bun:test";
import { canonicalize, contentHash } from "./hash.ts";

describe("canonicalize", () => {
  test("object key order does not matter", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  test("keys starting with `_` are non-semantic metadata, excluded from the encoding", () => {
    // extraction-only / version-dependent metadata (e.g. an ACL's owner default
    // privilege set) must not join the equality surface, or it would produce
    // spurious diff deltas / fingerprint drift across PG versions and snapshots.
    expect(canonicalize({ a: 1, _meta: [1, 2] })).toBe(canonicalize({ a: 1 }));
    expect(contentHash({ a: 1, _meta: ["x"] })).toBe(
      contentHash({ a: 1, _meta: ["y", "z"] }),
    );
    expect(canonicalize({ x: { a: 1, _m: 9 } })).toBe(
      canonicalize({ x: { a: 1 } }),
    );
  });

  test("nested key order does not matter", () => {
    expect(canonicalize({ x: { b: [1, { z: 1, y: 2 }], a: null } })).toBe(
      canonicalize({ x: { a: null, b: [1, { y: 2, z: 1 }] } }),
    );
  });

  test("array order DOES matter", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  test("scalar types are distinguished", () => {
    expect(canonicalize("1")).not.toBe(canonicalize(1));
    expect(canonicalize(true)).not.toBe(canonicalize("true"));
    expect(canonicalize(null)).not.toBe(canonicalize("null"));
    expect(canonicalize(1)).not.toBe(canonicalize(1n));
  });

  test("bigint is supported and stable", () => {
    expect(canonicalize({ v: 9007199254740993n })).toBe(
      canonicalize({ v: 9007199254740993n }),
    );
  });

  test("undefined object values are dropped (absent == undefined)", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  test("empty containers are distinct from null/absent", () => {
    const variants = [canonicalize({}), canonicalize([]), canonicalize(null)];
    expect(new Set(variants).size).toBe(3);
  });
});

describe("contentHash", () => {
  test("is a 64-char hex sha-256", () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  test("equal payloads hash equal, different payloads differ", () => {
    expect(contentHash({ a: [1, "x"], b: null })).toBe(
      contentHash({ b: null, a: [1, "x"] }),
    );
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  // Golden hashes pin the canonical encoding itself: if these break, the
  // encoding changed and every persisted snapshot/fingerprint would be
  // invalidated. Change them only deliberately, with a format-version bump.
  test("golden hashes", () => {
    expect(contentHash(null)).toBe(
      "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
    );
    expect(contentHash({ name: "users", cols: [1, 2n, "3", true, null] })).toBe(
      contentHash({ cols: [1, 2n, "3", true, null], name: "users" }),
    );
  });
});
