/**
 * Identity columns must reproduce their backing sequence's options (PR #299
 * review, supabase/pg-toolbelt). The identity payload only carried
 * {generation, sequence}, so a column declared
 * `GENERATED … AS IDENTITY (START WITH 10 INCREMENT BY 5 …)` was recreated as a
 * bare identity (default sequence parameters), and an options-only change
 * planned nothing. Pure rule/diff level — no DB.
 *
 * Default sequence parameters still render as a bare `GENERATED … AS IDENTITY`
 * so an ordinary identity column does not churn.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};
const tableId: StableId = { kind: "table", schema: "app", name: "t" };
const tableFact: Fact = {
  id: tableId,
  parent: { kind: "schema", name: "app" },
  payload: { owner: "test", persistence: "p" },
};
const colId: StableId = {
  kind: "column",
  schema: "app",
  table: "t",
  name: "id",
};
const colFact = (options: Record<string, unknown>): Fact => ({
  id: colId,
  parent: tableId,
  payload: {
    type: "integer",
    notNull: false,
    collation: null,
    generatedExpr: null,
    identity: {
      generation: "a",
      sequence: { schema: "app", name: "t_id_seq" },
      options: {
        increment: "1",
        start: "1",
        minValue: "1",
        maxValue: "2147483647",
        cache: "1",
        cycle: false,
        ...options,
      },
    },
  },
});
const base = (extra: Fact[]) =>
  buildFactBase([schemaFact, tableFact, ...extra], []);

describe("identity column sequence options", () => {
  test("non-default options render in the GENERATED … AS IDENTITY clause", () => {
    const sql = plan(base([]), base([colFact({ increment: "5", start: "10" })]))
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).toContain("GENERATED ALWAYS AS IDENTITY (");
    expect(sql).toContain("INCREMENT BY 5");
    expect(sql).toContain("START WITH 10");
  });

  test("all-default options render a bare GENERATED … AS IDENTITY", () => {
    const sql = plan(base([]), base([colFact({})]))
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).toContain("GENERATED ALWAYS AS IDENTITY");
    expect(sql).not.toContain("INCREMENT BY");
    expect(sql).not.toContain("(");
  });

  test("an options-only change is ONE in-place ALTER COLUMN with chained SETs", () => {
    const sql = plan(
      base([colFact({})]),
      base([colFact({ increment: "5", cache: "20" })]),
    ).actions.map((a) => a.sql);
    // combined into a single statement (chained SET clauses) — no RESTART, since
    // neither bound moved
    expect(sql).toContain(
      `ALTER TABLE "app"."t" ALTER COLUMN "id" SET INCREMENT BY 5 SET CACHE 20`,
    );
  });

  test("a cycle flip alters in place", () => {
    const sql = plan(
      base([colFact({})]),
      base([colFact({ cycle: true })]),
    ).actions.map((a) => a.sql);
    expect(sql).toContain(`ALTER TABLE "app"."t" ALTER COLUMN "id" SET CYCLE`);
  });

  test("moving both identity bounds emits ONE combined ALTER COLUMN (final-state valid) with RESTART", () => {
    const sql = plan(
      base([colFact({ minValue: "100", maxValue: "200", start: "100" })]),
      base([colFact({ minValue: "1", maxValue: "50", start: "1" })]),
    ).actions.map((a) => a.sql);
    // exactly one identity-options statement — per-field statements would run
    // `SET MAXVALUE 50` while MIN is still 100 (transient min>max) and fail.
    const idAlters = sql.filter((s) =>
      /ALTER COLUMN "id" SET (MINVALUE|MAXVALUE|START)/.test(s),
    );
    expect(idAlters).toHaveLength(1);
    expect(idAlters[0]).toContain("SET MINVALUE 1");
    expect(idAlters[0]).toContain("SET MAXVALUE 50");
    expect(idAlters[0]).toContain("SET START WITH 1");
    expect(idAlters[0]).toContain("RESTART");
  });

  test("an OVERLAPPING identity bound + START change must NOT RESTART a live counter", () => {
    // MAX 100→200 (widen) + START 50→60 with MIN unchanged: ranges [1,100] and
    // [1,200] overlap, so a live counter stays valid. RESTART would replay
    // already-issued values → duplicate keys. Only a DISJOINT shift may RESTART.
    const sql = plan(
      base([colFact({ minValue: "1", maxValue: "100", start: "50" })]),
      base([colFact({ minValue: "1", maxValue: "200", start: "60" })]),
    ).actions.map((a) => a.sql);
    const idAlters = sql.filter((s) =>
      /ALTER COLUMN "id" SET (MINVALUE|MAXVALUE|START)/.test(s),
    );
    expect(idAlters).toHaveLength(1);
    expect(idAlters[0]).toContain("SET MAXVALUE 200");
    expect(idAlters[0]).toContain("SET START WITH 60");
    expect(idAlters[0]).not.toContain("RESTART");
  });
});
