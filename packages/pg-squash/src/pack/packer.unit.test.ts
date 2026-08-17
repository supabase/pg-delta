import { describe, expect, test } from "bun:test";
import type { SquashStatement } from "../model/statement.ts";
import { pack, type PackItem } from "./index.ts";

const stmt = (text: string, file = "a.sql", index = 0): SquashStatement => ({
  text,
  source: {
    file,
    statementIndex: index,
    bytes: { start: 0, end: text.length },
  },
});

describe("pack", () => {
  test("merges consecutive non-barrier statements into one txn", () => {
    const items: PackItem[] = [
      {
        type: "statement",
        stmt: stmt("CREATE TABLE t (id int);"),
        isBarrier: false,
        floorId: null,
      },
      {
        type: "statement",
        stmt: stmt("CREATE INDEX t_id ON t (id);", "a.sql", 1),
        isBarrier: false,
        floorId: null,
      },
    ];
    const { segments, diagnostics } = pack(items);
    expect(diagnostics).toHaveLength(0);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "txn" });
    if (segments[0]?.type === "txn") {
      expect(segments[0].statements).toHaveLength(2);
    }
  });

  test("isolates barriers and opaque files as their own segments", () => {
    const items: PackItem[] = [
      {
        type: "statement",
        stmt: stmt("CREATE TABLE t (id int);"),
        isBarrier: false,
        floorId: null,
      },
      {
        type: "statement",
        stmt: stmt("CREATE INDEX CONCURRENTLY t_id ON t (id);", "a.sql", 1),
        isBarrier: true,
        floorId: null,
      },
      { type: "opaque", file: "copy.sql", sql: "COPY t FROM stdin;\n1\n\\.\n" },
      {
        type: "statement",
        stmt: stmt("ANALYZE t;", "b.sql", 0),
        isBarrier: false,
        floorId: null,
      },
    ];
    const { segments } = pack(items);
    expect(segments.map((s) => s.type)).toEqual([
      "txn",
      "barrier",
      "opaqueFile",
      "txn",
    ]);
  });

  test("does not split an explicit-txn floor when a barrier sits inside it", () => {
    const items: PackItem[] = [
      {
        type: "statement",
        stmt: stmt("CREATE TABLE t (id int);"),
        isBarrier: false,
        floorId: 1,
      },
      {
        type: "statement",
        stmt: stmt("CREATE INDEX CONCURRENTLY t_id ON t (id);", "a.sql", 1),
        isBarrier: true,
        floorId: 1,
      },
    ];
    const { segments, diagnostics } = pack(items);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.type).toBe("txn");
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "explicit-txn-floor" }),
    );
  });

  test("splitBefore flushes a new txn before the named statement", () => {
    const items: PackItem[] = [
      {
        type: "statement",
        stmt: stmt("CREATE TABLE t (id int);"),
        isBarrier: false,
        floorId: null,
      },
      {
        type: "statement",
        stmt: stmt("CREATE INDEX t_id ON t (id);", "b.sql", 0),
        isBarrier: false,
        floorId: null,
      },
    ];
    const { segments, statementKeys } = pack(items, new Set(["b.sql:0"]));
    expect(segments).toHaveLength(2);
    expect(statementKeys).toEqual(["a.sql:0", "b.sql:0"]);
  });

  test("splitBefore may flush at the start of an explicit-txn floor", () => {
    const items: PackItem[] = [
      {
        type: "statement",
        stmt: stmt("SET search_path TO other;"),
        isBarrier: false,
        floorId: null,
      },
      {
        type: "statement",
        stmt: stmt("BEGIN;", "b.sql", 0),
        isBarrier: false,
        floorId: 1,
      },
      {
        type: "statement",
        stmt: stmt("CREATE TABLE t (id int);", "b.sql", 1),
        isBarrier: false,
        floorId: 1,
      },
      {
        type: "statement",
        stmt: stmt("COMMIT;", "b.sql", 2),
        isBarrier: false,
        floorId: 1,
      },
    ];
    const { segments } = pack(items, new Set(["b.sql:0"]));
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.type)).toEqual(["txn", "txn"]);
  });

  test("splitBefore still does not cut through the middle of a floor", () => {
    const items: PackItem[] = [
      {
        type: "statement",
        stmt: stmt("BEGIN;"),
        isBarrier: false,
        floorId: 1,
      },
      {
        type: "statement",
        stmt: stmt("CREATE TABLE t (id int);", "a.sql", 1),
        isBarrier: false,
        floorId: 1,
      },
      {
        type: "statement",
        stmt: stmt("COMMIT;", "a.sql", 2),
        isBarrier: false,
        floorId: 1,
      },
    ];
    const { segments } = pack(items, new Set(["a.sql:1"]));
    expect(segments).toHaveLength(1);
  });

  test("is minimal: N non-barrier statements squash to 1 segment", () => {
    const items: PackItem[] = Array.from({ length: 20 }, (_, i) => ({
      type: "statement" as const,
      stmt: stmt(`CREATE TABLE t${i} (id int);`, "a.sql", i),
      isBarrier: false,
      floorId: null,
    }));
    expect(pack(items).segments).toHaveLength(1);
  });
});
