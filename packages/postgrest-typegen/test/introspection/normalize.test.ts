import { describe, expect, test } from "bun:test";

import {
  coerceInt8Value,
  normalizeRow,
  normalizeRows,
} from "../../src/introspection/normalize.ts";

/**
 * Reference implementation of postgres-meta's `setTypeParser(INT8, ...)` from
 * `src/lib/db.ts`, used to assert byte-for-byte equivalence.
 */
function dbTsInt8Parser(x: string): string | number {
  const asNumber = Number(x);
  if (Number.isSafeInteger(asNumber)) {
    return asNumber;
  } else {
    return x;
  }
}

describe("coerceInt8Value", () => {
  test("matches db.ts int8 parser for representative values", () => {
    const samples = [
      "0",
      "1",
      "16385",
      "9007199254740991", // Number.MAX_SAFE_INTEGER
      "9007199254740993", // beyond safe integer → stays string
      "123456789012345678901234567890",
    ];
    for (const s of samples) {
      expect(coerceInt8Value(s)).toBe(dbTsInt8Parser(s));
    }
  });

  test("passes through non-string values unchanged", () => {
    expect(coerceInt8Value(42)).toBe(42);
    expect(coerceInt8Value(null)).toBe(null);
    expect(coerceInt8Value(undefined)).toBe(undefined);
  });

  test("leaves composite text ids (e.g. column id) untouched", () => {
    // Columns expose id as `<oid>.<attnum>` (text, not int8). It is not a safe
    // integer, so it must survive coercion exactly as postgres-meta leaves it.
    expect(coerceInt8Value("16385.1")).toBe("16385.1");
    expect(coerceInt8Value("16385.10")).toBe("16385.10");
  });

  test("large unsafe integer string is preserved verbatim", () => {
    expect(coerceInt8Value("9223372036854775807")).toBe("9223372036854775807");
  });
});

describe("normalizeRow", () => {
  test("coerces known int8 fields and leaves others alone", () => {
    const row: Record<string, unknown> = {
      id: "16385",
      table_id: "16385",
      type_relation_id: "16390",
      return_type_id: "23",
      return_type_relation_id: null,
      bytes: "8192",
      live_rows_estimate: "100",
      dead_rows_estimate: "0",
      name: "tickets",
      schema: "public",
      // not in the int8 set — must remain a string even though numeric
      argument_types: "12345",
    };

    expect(normalizeRow({ ...row })).toEqual({
      id: 16385,
      table_id: 16385,
      type_relation_id: 16390,
      return_type_id: 23,
      return_type_relation_id: null,
      bytes: 8192,
      live_rows_estimate: 100,
      dead_rows_estimate: 0,
      name: "tickets",
      schema: "public",
      argument_types: "12345",
    });
  });

  test("preserves a column row's composite text id", () => {
    const row: Record<string, unknown> = {
      table_id: "16385",
      id: "16385.2",
      name: "status",
    };
    expect(normalizeRow(row)).toEqual({
      table_id: 16385,
      id: "16385.2",
      name: "status",
    });
  });
});

describe("normalizeRows", () => {
  test("normalizes every row", () => {
    const rows: Record<string, unknown>[] = [
      { id: "1" },
      { id: "2" },
      { id: "9007199254740993" },
    ];
    expect(normalizeRows(rows)).toEqual([
      { id: 1 },
      { id: 2 },
      { id: "9007199254740993" },
    ]);
  });
});
