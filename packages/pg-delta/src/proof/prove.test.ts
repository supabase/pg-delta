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
import type { Pool } from "pg";
import { buildFactBase } from "../core/fact.ts";
import { ENGINE_VERSION, stampPlanId, type Plan } from "../plan/plan.ts";
import {
  composeAutoSeedBaseline,
  detectAutoSeedSideEffects,
  detectViolations,
  provePlan,
  reconcileSeedOutcomes,
  relKey,
  type SeedOutcome,
} from "./prove.ts";

// TableStat is module-internal; the tests only need its shape.
type Stat = {
  rows: number;
  relfilenode: string;
  schemaSig: string;
  content?: string;
};

const ctx = (over: Partial<Parameters<typeof detectViolations>[2]> = {}) => ({
  recreatedTables: new Set<string>(),
  explicitlyDestroyedRelations: new Set<string>(),
  declaredRewriteTables: new Set<string>(),
  ...over,
});

// The before/after maps are keyed by relKey (a JSON [schema, name] tuple) — the
// same collision-free key provePlan uses; build them from readable parts.
const m = (entries: Array<[schema: string, name: string, stat: Stat]>) =>
  new Map<string, Stat>(entries.map(([s, n, stat]) => [relKey(s, n), stat]));

const SIG = "id:23"; // a stable column signature

describe("provePlan — destruction metadata preflight", () => {
  test("a mislabeled column drop cannot reach the clone or false-green", async () => {
    const empty = buildFactBase([], []);
    const column = {
      kind: "column" as const,
      schema: "app",
      table: "t",
      name: "secret",
    };
    const thePlan: Plan = stampPlanId({
      formatVersion: 1,
      engineVersion: ENGINE_VERSION,
      source: { fingerprint: empty.rootHash },
      target: { fingerprint: empty.rootHash },
      preamble: [],
      deltas: [],
      filteredDeltas: [],
      renameCandidates: [],
      actions: [
        {
          sql: `ALTER TABLE app.t DROP COLUMN secret`,
          verb: "drop",
          produces: [],
          consumes: [],
          destroys: [column],
          releases: [],
          transactionality: "transactional",
          lockClass: "accessExclusive",
          newSegmentBefore: false,
          dataLoss: "none",
          rewriteRisk: false,
        },
      ],
      safetyReport: {
        destructiveActions: 0,
        rewriteRiskActions: 0,
        nonTransactionalActions: 0,
        lockClasses: { accessExclusive: 1 },
      },
    });
    const verdict = await provePlan(thePlan, {} as Pool, empty, {
      reextract: () => {
        throw new Error("proof touched the clone before rejecting metadata");
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.safetyMetadataViolations).toEqual([
      { actionIndex: 0, object: column },
    ]);
  });

  test("a mutated plan is rejected by the planId preflight before any clone work", async () => {
    const empty = buildFactBase([], []);
    const stamped = stampPlanId({
      formatVersion: 1,
      engineVersion: ENGINE_VERSION,
      source: { fingerprint: empty.rootHash },
      target: { fingerprint: empty.rootHash },
      preamble: [],
      deltas: [],
      filteredDeltas: [],
      renameCandidates: [],
      actions: [],
      safetyReport: {
        destructiveActions: 0,
        rewriteRiskActions: 0,
        nonTransactionalActions: 0,
        lockClasses: {},
      },
    });
    const tampered: Plan = {
      ...stamped,
      actions: [
        {
          sql: "DROP SCHEMA app CASCADE",
          verb: "drop",
          produces: [],
          consumes: [],
          destroys: [],
          releases: [],
          transactionality: "transactional",
          lockClass: "accessExclusive",
          newSegmentBefore: false,
          dataLoss: "none",
          rewriteRisk: false,
        },
      ],
    };
    expect(
      provePlan(tampered, {} as Pool, empty, {
        reextract: () => {
          throw new Error("proof touched the clone before rejecting planId");
        },
      }),
    ).rejects.toThrow(/planId.*re-plan/);
  });
});

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
      ctx({
        recreatedTables: new Set([OLD]),
        explicitlyDestroyedRelations: new Set([OLD]),
      }),
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
      ctx({
        recreatedTables: new Set([relKey("public", "t")]),
        explicitlyDestroyedRelations: new Set([relKey("public", "t")]),
      }),
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

  test("a preexisting empty relation missing afterward fails unless explicitly destroyed", () => {
    const key = relKey("public", "empty");
    const before = m([
      ["public", "empty", { rows: 0, relfilenode: "1", schemaSig: SIG }],
    ]);
    const undeclared = detectViolations(before, new Map(), ctx());
    expect(undeclared.dataViolations).toEqual([
      {
        table: { schema: "public", name: "empty" },
        before: 0,
        after: 0,
        missingAfter: true,
      },
    ]);
    expect(undeclared.coverage.tablesSkipped).toEqual([]);

    const declared = detectViolations(
      before,
      new Map(),
      ctx({ explicitlyDestroyedRelations: new Set([key]) }),
    );
    expect(declared.dataViolations).toEqual([]);
    expect(declared.coverage.tablesSkipped).toEqual([
      {
        table: { schema: "public", name: "empty" },
        reason: "dropped by the plan",
      },
    ]);
  });
});

describe("reconcileSeedOutcomes — provisional seeds vs the final snapshot", () => {
  const stats = (entries: Array<[string, string, number]>) =>
    new Map(
      entries.map(([s, n, rows]) => [
        relKey(s, n),
        { rows, relfilenode: "1", schemaSig: SIG },
      ]),
    );

  test("a `seeded` row absent from the final snapshot is downgraded to no_row", () => {
    const outcomes: SeedOutcome[] = [
      { table: { schema: "s", name: "gone" }, status: "seeded" },
    ];
    expect(reconcileSeedOutcomes(outcomes, stats([["s", "gone", 0]]))).toEqual([
      {
        table: { schema: "s", name: "gone" },
        status: "skipped",
        reasonCode: "no_row",
      },
    ]);
  });

  test("a `seeded` row that persists stays seeded", () => {
    const outcomes: SeedOutcome[] = [
      { table: { schema: "s", name: "kept" }, status: "seeded" },
    ];
    expect(reconcileSeedOutcomes(outcomes, stats([["s", "kept", 1]]))).toEqual(
      outcomes,
    );
  });

  test("skipped / failed outcomes pass through unchanged", () => {
    const outcomes: SeedOutcome[] = [
      {
        table: { schema: "s", name: "a" },
        status: "skipped",
        reasonCode: "23502",
      },
      {
        table: { schema: "s", name: "b" },
        status: "failed",
        reasonCode: "P0001",
        message: "boom",
      },
    ];
    // present with rows 0, but they are already terminal — not reconciled
    expect(
      reconcileSeedOutcomes(
        outcomes,
        stats([
          ["s", "a", 0],
          ["s", "b", 0],
        ]),
      ),
    ).toEqual(outcomes);
  });

  test("a `seeded` table missing from the snapshot is left seeded (defensive)", () => {
    const outcomes: SeedOutcome[] = [
      { table: { schema: "s", name: "orphan" }, status: "seeded" },
    ];
    expect(reconcileSeedOutcomes(outcomes, stats([]))).toEqual(outcomes);
  });
});

describe("composeAutoSeedBaseline — preserve original data across seeding", () => {
  const stats = (entries: Array<[string, string, number]>) =>
    new Map(
      entries.map(([s, n, rows]) => [
        relKey(s, n),
        { rows, relfilenode: String(rows), schemaSig: SIG },
      ]),
    );

  test("keeps pre-seed stats for populated tables and post-seed stats for empty tables", () => {
    const preSeed = stats([
      ["s", "populated", 2],
      ["s", "empty", 0],
    ]);
    const postSeed = stats([
      ["s", "populated", 0],
      ["s", "empty", 1],
    ]);

    const baseline = composeAutoSeedBaseline(preSeed, postSeed);
    expect(baseline.get(relKey("s", "populated"))?.rows).toBe(2);
    expect(baseline.get(relKey("s", "empty"))?.rows).toBe(1);
  });

  test("retains a populated pre-seed table even if a seed trigger removes it", () => {
    const preSeed = stats([["s", "removed", 1]]);
    const baseline = composeAutoSeedBaseline(preSeed, stats([]));
    expect(baseline.get(relKey("s", "removed"))?.rows).toBe(1);
  });
});

describe("detectAutoSeedSideEffects — pre-plan data guard", () => {
  test("detects equal-row-count content changes on populated tables", () => {
    const preSeed = m([
      [
        "s",
        "populated",
        { rows: 1, relfilenode: "1", schemaSig: SIG, content: "original" },
      ],
    ]);
    const postSeed = m([
      [
        "s",
        "populated",
        { rows: 1, relfilenode: "1", schemaSig: SIG, content: "mutated" },
      ],
    ]);

    expect(detectAutoSeedSideEffects(preSeed, postSeed, new Set())).toEqual([
      {
        table: { schema: "s", name: "populated" },
        before: 1,
        after: 1,
        contentChanged: true,
      },
    ]);
  });

  test("ignores intentional synthetic rows in originally-empty tables", () => {
    const preSeed = m([
      ["s", "empty", { rows: 0, relfilenode: "1", schemaSig: SIG }],
    ]);
    const postSeed = m([
      [
        "s",
        "empty",
        { rows: 1, relfilenode: "1", schemaSig: SIG, content: "synthetic" },
      ],
    ]);

    expect(detectAutoSeedSideEffects(preSeed, postSeed, new Set())).toEqual([]);
  });

  test("rejects seed-time schema changes on originally-empty kept tables", () => {
    const preSeed = m([
      ["s", "empty", { rows: 0, relfilenode: "1", schemaSig: SIG }],
    ]);
    const postSeed = m([
      [
        "s",
        "empty",
        {
          rows: 1,
          relfilenode: "2",
          schemaSig: `${SIG},note:25`,
          content: "synthetic",
        },
      ],
    ]);

    expect(detectAutoSeedSideEffects(preSeed, postSeed, new Set())).toEqual([
      {
        table: { schema: "s", name: "empty" },
        before: 0,
        after: 1,
        schemaChanged: true,
      },
    ]);
  });

  test("ignores populated tables the plan intentionally recreates", () => {
    const table = relKey("s", "recreated");
    const preSeed = m([
      [
        "s",
        "recreated",
        { rows: 1, relfilenode: "1", schemaSig: SIG, content: "original" },
      ],
    ]);
    const postSeed = m([
      ["s", "recreated", { rows: 0, relfilenode: "1", schemaSig: SIG }],
    ]);

    expect(
      detectAutoSeedSideEffects(preSeed, postSeed, new Set([table])),
    ).toEqual([]);
  });

  test("rejects seed-time schema changes on populated kept tables", () => {
    const preSeed = m([
      [
        "s",
        "populated",
        { rows: 1, relfilenode: "1", schemaSig: SIG, content: "before" },
      ],
    ]);
    const postSeed = m([
      [
        "s",
        "populated",
        {
          rows: 1,
          relfilenode: "2",
          schemaSig: `${SIG},note:25`,
          content: "after",
        },
      ],
    ]);

    expect(detectAutoSeedSideEffects(preSeed, postSeed, new Set())).toEqual([
      {
        table: { schema: "s", name: "populated" },
        before: 1,
        after: 1,
        schemaChanged: true,
      },
    ]);
  });
});
