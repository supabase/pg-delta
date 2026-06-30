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

/** SHA-256 (hex) over the canonical encoding. ≥128-bit per §3.1. */
export function contentHash(value: PayloadValue): ContentHash {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

/** Hash an already-canonical string (used by rollups to fold hashes). */
export function hashString(s: string): ContentHash {
  return createHash("sha256").update(s).digest("hex");
}
