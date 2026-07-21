/**
 * Unit tests for the pure proof verdict logic (src/proof/prove.ts
 * detectViolations). No Docker / database required.
 *
 * Hardening Item 2 / review #3: row-count preservation is not content
 * preservation. A content change on a table the plan did NOT touch is a
 * data-preservation violation; on a table the plan alters it is expected. The
 * proof reports honest per-table coverage instead of a bare boolean.
 */
import { describe, expect, test } from "bun:test";
import { detectViolations, relKey } from "./prove.ts";

// TableStat is module-internal; the tests only need its shape.
type Stat = {
  rows: number;
  relfilenode: string;
  schemaSig: string;
  content?: string;
};

const ctx = (over: Partial<Parameters<typeof detectViolations>[2]> = {}) => ({
  recreatedTables: new Set<string>(),
  declaredRewriteTables: new Set<string>(),
  ...over,
});

// The before/after maps are keyed by relKey (a JSON [schema, name] tuple) — the
// same collision-free key provePlan uses; build them from readable parts.
const m = (entries: Array<[schema: string, name: string, stat: Stat]>) =>
  new Map<string, Stat>(entries.map(([s, n, stat]) => [relKey(s, n), stat]));

const SIG = "id:23"; // a stable column signature

describe("detectViolations — content + coverage (review #3)", () => {
  test("row count change is a data violation", () => {
    const before = m([
      [
        "public",
        "t",
        { rows: 3, relfilenode: "1", schemaSig: SIG, content: "a" },
      ],
    ]);
    const after = m([
      [
        "public",
        "t",
        { rows: 2, relfilenode: "1", schemaSig: SIG, content: "b" },
      ],
    ]);
    const v = detectViolations(before, after, ctx());
    expect(v.dataViolations).toEqual([
      { table: { schema: "public", name: "t" }, before: 3, after: 2 },
    ]);
  });

  test("content change with UNCHANGED schema is a violation (count held)", () => {
    const before = m([
      [
        "public",
        "t",
        { rows: 2, relfilenode: "1", schemaSig: SIG, content: "a" },
      ],
    ]);
    const after = m([
      [
        "public",
        "t",
        { rows: 2, relfilenode: "1", schemaSig: SIG, content: "b" },
      ],
    ]);
    const v = detectViolations(before, after, ctx());
    expect(v.dataViolations).toEqual([
      {
        table: { schema: "public", name: "t" },
        before: 2,
        after: 2,
        contentChanged: true,
      },
    ]);
  });

  test("content change under a SCHEMA change is expected, not a violation", () => {
    // e.g. a column propagated from a partitioned parent: whole-row text
    // changes but no data was lost — schemaSig differs, so only count is trusted
    const before = m([
      [
        "public",
        "t",
        { rows: 2, relfilenode: "1", schemaSig: SIG, content: "a" },
      ],
    ]);
    const after = m([
      [
        "public",
        "t",
        {
          rows: 2,
          relfilenode: "2",
          schemaSig: `${SIG},note:25`,
          content: "b",
        },
      ],
    ]);
    const v = detectViolations(
      before,
      after,
      ctx({ declaredRewriteTables: new Set([relKey("public", "t")]) }),
    );
    expect(v.dataViolations).toEqual([]);
    expect(v.rewriteViolations).toEqual([]);
  });

  test("coverage classifies content modes honestly", () => {
    const before = m([
      // non-empty, schema stable → fingerprint
      [
        "public",
        "checked",
        { rows: 1, relfilenode: "1", schemaSig: SIG, content: "x" },
      ],
      // non-empty, schema changed → count
      [
        "public",
        "altered",
        { rows: 1, relfilenode: "1", schemaSig: SIG, content: "y" },
      ],
      // empty → none
      ["public", "empty", { rows: 0, relfilenode: "1", schemaSig: SIG }],
    ]);
    const after = m([
      [
        "public",
        "checked",
        { rows: 1, relfilenode: "1", schemaSig: SIG, content: "x" },
      ],
      [
        "public",
        "altered",
        {
          rows: 1,
          relfilenode: "1",
          schemaSig: `${SIG},note:25`,
          content: "y2",
        },
      ],
      ["public", "empty", { rows: 0, relfilenode: "1", schemaSig: SIG }],
    ]);
    const v = detectViolations(before, after, ctx());
    const mode = (name: string) =>
      v.coverage.perTable.find(
        (p) => p.table.schema === "public" && p.table.name === name,
      )?.contentMode;
    expect(v.coverage.tablesChecked).toBe(3);
    expect(mode("checked")).toBe("fingerprint");
    expect(mode("altered")).toBe("count");
    expect(mode("empty")).toBe("none");
  });

  test("renamed table is CHECKED under the new name; a doctored change is a violation (F7)", () => {
    const OLD = relKey("public", "old");
    const NEW = relKey("public", "new");

    // RED baseline: with NO rename map, the real planner puts the OLD relKey in
    // recreatedTables (an accepted rename destroys the old subtree), and the NEW
    // relKey in `after` has no before-match — so the renamed table is neither
    // checked nor a violation. A silent data-preservation blind spot.
    const before = m([
      [
        "public",
        "old",
        { rows: 3, relfilenode: "1", schemaSig: SIG, content: "a" },
      ],
    ]);
    // data now lives under the NEW name; doctor its content (count held)
    const after = m([
      [
        "public",
        "new",
        { rows: 3, relfilenode: "1", schemaSig: SIG, content: "b" },
      ],
    ]);
    const baseline = detectViolations(
      before,
      after,
      ctx({ recreatedTables: new Set([OLD]) }),
    );
    expect(baseline.coverage.tablesChecked).toBe(0);
    expect(baseline.coverage.tablesSkipped.map((s) => s.table.name)).toContain(
      "old",
    );

    // GREEN: with the rename map old→new (and the source removed from
    // recreatedTables, as provePlan does), the table is CHECKED under the NEW
    // name and the doctored content is reported as a data violation.
    const v = detectViolations(
      before,
      after,
      ctx({ renamedTables: new Map([[OLD, NEW]]) }),
    );
    expect(v.coverage.tablesChecked).toBe(1);
    expect(v.coverage.perTable[0]?.table).toEqual({
      schema: "public",
      name: "new",
    });
    expect(v.coverage.tablesSkipped).toEqual([]);
    expect(v.dataViolations).toEqual([
      {
        table: { schema: "public", name: "new" },
        before: 3,
        after: 3,
        contentChanged: true,
      },
    ]);
  });

  test("recreated tables are skipped with a reason, not checked", () => {
    const before = m([
      [
        "public",
        "t",
        { rows: 5, relfilenode: "1", schemaSig: SIG, content: "a" },
      ],
    ]);
    const after = m([
      [
        "public",
        "t",
        { rows: 0, relfilenode: "9", schemaSig: SIG, content: "" },
      ],
    ]);
    const v = detectViolations(
      before,
      after,
      ctx({ recreatedTables: new Set([relKey("public", "t")]) }),
    );
    expect(v.dataViolations).toEqual([]); // recreated → row/content change expected
    expect(v.coverage.tablesChecked).toBe(0);
    expect(v.coverage.tablesSkipped).toEqual([
      {
        table: { schema: "public", name: "t" },
        reason: "recreated by the plan",
      },
    ]);
  });
});
