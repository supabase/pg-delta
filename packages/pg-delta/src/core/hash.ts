/**
 * Canonical payload encoding + content hashing (target-architecture §3.1).
 *
 * The canonical encoding is the equality surface of the whole system: fact
 * hashes, rollups, fingerprints, and proof verdicts all reduce to it. Its
 * exact byte output is pinned by golden tests — changing it is a
 * format-version bump, never a refactor.
 *
 * Rules:
 * - object keys sorted by code point; `undefined` values dropped (absent)
 * - object keys starting with `_` are NON-SEMANTIC METADATA and are dropped:
 *   extraction-only / environment- or version-dependent values (e.g. an ACL's
 *   create-time owner default privilege set) ride along on the payload for the
 *   planner but must NOT join the equality surface, or they would cause spurious
 *   diff deltas and fingerprint drift across PG versions and snapshots
 * - arrays preserve order (set-valued attributes must be sorted upstream,
 *   at payload construction)
 * - scalars are type-distinguished: `"1"` ≠ `1` ≠ `1n`
 * - non-finite numbers are rejected (no NaN/Infinity in payloads)
 */
import { createHash } from "node:crypto";

export type Payload = { [key: string]: PayloadValue };
export type PayloadValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | PayloadValue[]
  | { [key: string]: PayloadValue };

export function canonicalize(value: PayloadValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return `${value}n`;
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`canonicalize: non-finite number ${value}`);
      }
      // normalize -0 so it cannot produce a distinct encoding
      return JSON.stringify(value === 0 ? 0 : value);
    case "undefined":
      throw new Error(
        "canonicalize: undefined is only allowed as an (omitted) object value",
      );
    case "object": {
      if (Array.isArray(value)) {
        return `[${value
          .map((item) => {
            if (item === undefined) {
              throw new Error(
                "canonicalize: arrays must not contain undefined",
              );
            }
            return canonicalize(item);
          })
          .join(",")}]`;
      }
      const keys = Object.keys(value)
        .filter((k) => value[k] !== undefined && !k.startsWith("_"))
        .sort();
      return `{${keys
        .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
        .join(",")}}`;
    }
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

export type ContentHash = string;

/**
 * Memoization. Purely a cache: every digest below is the same SHA-256 over the
 * same canonical encoding it has always been, so the hash format is untouched.
 *
 * Hashing is the single hottest thing the engine does, and almost all of it is
 * repeat work. A fact base re-hashes every payload on every REBUILD (managed
 * view reconstruction, scope/target projection, identity normalization — see
 * `policy/reconstruct.ts`, `plan/project.ts`, `plan/identity-normalize.ts`), and
 * a big catalog's payloads are highly repetitive to begin with (a million
 * columns share a few thousand distinct canonical encodings).
 */

/**
 * Payload object -> digest. Skips `canonicalize` entirely, which is what makes
 * a rebuild that re-indexes the same `Fact` objects nearly free.
 *
 * INVARIANT: a payload object is never mutated after it has first been hashed.
 * Payloads are built once (extract / load / snapshot decode) and thereafter
 * only read; every transform that changes one returns a NEW object (e.g.
 * `normalizePayload` in `plan/identity-normalize.ts`). An in-place mutation
 * after the first hash would silently keep the stale digest. Weak keys, so
 * entries die with the facts that own them.
 */
const payloadHashes = new WeakMap<object, ContentHash>();

/**
 * Canonical encoding -> digest. This is the correctness-bearing layer: the
 * canonical string IS the equality surface, so distinct objects that encode
 * identically must collapse to one digest.
 *
 * Bounded by total key length rather than entry count, because the strings
 * folded here range from tiny payload encodings to whole-subtree rollup folds.
 * Past the budget the cache is dropped wholesale and refills — a long-lived
 * process (watch mode, a server planning many databases) cannot accumulate.
 * A single key whose own length already exceeds the budget is never inserted
 * (see the early return below) — otherwise it would sit retained past the
 * advertised bound until the next miss happens to clear the whole map.
 */
const canonicalHashes = new Map<string, ContentHash>();
const CANONICAL_CACHE_MAX_CHARS = 1 << 24;
let canonicalCacheChars = 0;

function digest(canonical: string): ContentHash {
  const cached = canonicalHashes.get(canonical);
  if (cached !== undefined) return cached;
  const hash = createHash("sha256").update(canonical).digest("hex");
  // Oversized key (e.g. a giant view/function payload): the digest is still
  // correct, just not memoized — caching it would blow past the budget and
  // stay retained indefinitely instead of merely until the next clear.
  if (canonical.length > CANONICAL_CACHE_MAX_CHARS) return hash;
  if (canonicalCacheChars >= CANONICAL_CACHE_MAX_CHARS) {
    canonicalHashes.clear();
    canonicalCacheChars = 0;
  }
  canonicalHashes.set(canonical, hash);
  canonicalCacheChars += canonical.length;
  return hash;
}

/** SHA-256 (hex) over the canonical encoding. ≥128-bit per §3.1. */
export function contentHash(value: PayloadValue): ContentHash {
  if (value === null || typeof value !== "object") {
    return digest(canonicalize(value));
  }
  const cached = payloadHashes.get(value);
  if (cached !== undefined) return cached;
  const hash = digest(canonicalize(value));
  payloadHashes.set(value, hash);
  return hash;
}

/** Hash an already-canonical string (used by rollups to fold hashes). */
export function hashString(s: string): ContentHash {
  return digest(s);
}
