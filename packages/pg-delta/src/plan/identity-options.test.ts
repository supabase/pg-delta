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
const colFact = (options: Record<string, unknown>, type = "integer"): Fact => ({
  id: colId,
  parent: tableId,
  payload: {
    type,
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

/** A column type change is sandwiched DROP DEFAULT → TYPE … USING → SET DEFAULT,
 *  but PostgreSQL rejects DROP DEFAULT on an identity or generated column, and
 *  rejects the USING cast on a generated one. Identity add/drop deltas order
 *  BEFORE the type action (the differ emits attributes on one fact
 *  alphabetically, `identity` < `type`, and the topo tie-break is emission
 *  index), so the DROP DEFAULT gate must read the DESIRED-side identity — that
 *  is the column's state by the time the type action runs.
 *
 *  Changing an identity column's type also moves its implicit sequence's
 *  bounds. Those ride relative to the TYPE statement by direction: AFTER when
 *  widening (the desired values may not fit the old type yet), BEFORE when
 *  narrowing (an out-of-range explicit bound would make the retype itself
 *  fail). */
describe("identity / generated columns through a type change", () => {
  const bareCol = (type: string, extra: Record<string, unknown>): Fact => ({
    id: colId,
    parent: tableId,
    payload: {
      type,
      notNull: false,
      collation: null,
      generatedExpr: null,
      identity: null,
      ...extra,
    },
  });

  test("widening an identity column emits TYPE first, then the bounds, and no DROP DEFAULT", () => {
    const sql = plan(
      base([colFact({ maxValue: "2147483647" })]),
      base([colFact({ maxValue: "9223372036854775807" }, "bigint")]),
    ).actions.map((a) => a.sql);
    expect(sql.some((s) => s.includes("DROP DEFAULT"))).toBe(false);
    const typeAt = sql.findIndex((s) => s.includes("TYPE bigint"));
    const boundsAt = sql.findIndex((s) => s.includes("SET MAXVALUE"));
    expect(typeAt).toBeGreaterThanOrEqual(0);
    // the bounds must FOLLOW the retype: the backing sequence is still
    // integer-typed before it ("MAXVALUE … is out of range")
    expect(boundsAt).toBeGreaterThan(typeAt);
    // and only once — identity.alter must not emit its own copy
    expect(sql.filter((s) => s.includes("SET MAXVALUE"))).toHaveLength(1);
  });

  test("NARROWING an identity column emits the bounds BEFORE the TYPE", () => {
    // bigint identity with an explicit MAXVALUE 5000000000 → integer. Retyping
    // first fails ("MAXVALUE (5000000000) is out of range for sequence data
    // type integer"), so the in-range desired bound must land first. Valid in
    // this direction because the desired values fit the narrower type, which is
    // a subset of the old (wider) type's range.
    const sql = plan(
      base([colFact({ maxValue: "5000000000" }, "bigint")]),
      base([colFact({ maxValue: "2147483647" })]),
    ).actions.map((a) => a.sql);
    const typeAt = sql.findIndex((s) => s.includes("TYPE integer"));
    const boundsAt = sql.findIndex((s) =>
      s.includes("SET MAXVALUE 2147483647"),
    );
    expect(typeAt).toBeGreaterThanOrEqual(0);
    expect(boundsAt).toBeGreaterThanOrEqual(0);
    expect(boundsAt).toBeLessThan(typeAt);
    expect(sql.filter((s) => s.includes("SET MAXVALUE"))).toHaveLength(1);
  });

  test("a generated column's type change carries neither DROP DEFAULT nor a USING cast", () => {
    const generated = (type: string) =>
      bareCol(type, { generatedExpr: "(qty * 2)" });
    const sql = plan(
      base([generated("integer")]),
      base([generated("bigint")]),
    ).actions.map((a) => a.sql);
    expect(sql).toContain(
      `ALTER TABLE "app"."t" ALTER COLUMN "id" TYPE bigint`,
    );
    expect(sql.some((s) => s.includes("DROP DEFAULT"))).toBe(false);
    expect(sql.some((s) => s.includes("USING"))).toBe(false);
  });

  test("a plain column's type change keeps the DROP DEFAULT → TYPE … USING sandwich", () => {
    const sql = plan(
      base([bareCol("integer", {})]),
      base([bareCol("bigint", {})]),
    ).actions.map((a) => a.sql);
    const dropAt = sql.indexOf(
      `ALTER TABLE "app"."t" ALTER COLUMN "id" DROP DEFAULT`,
    );
    const typeAt = sql.indexOf(
      `ALTER TABLE "app"."t" ALTER COLUMN "id" TYPE bigint USING "id"::bigint`,
    );
    expect(dropAt).toBeGreaterThanOrEqual(0);
    expect(typeAt).toBe(dropAt + 1);
  });

  // The DROP DEFAULT gate reads the DESIRED-side identity: identity add/drop
  // deltas order BEFORE the type action, so the desired identity state is the
  // column's actual state when DROP DEFAULT runs. All four quadrants:

  test("gate quadrant identity→identity: no DROP DEFAULT", () => {
    const sql = plan(
      base([colFact({ maxValue: "2147483647" })]),
      base([colFact({ maxValue: "9223372036854775807" }, "bigint")]),
    ).actions.map((a) => a.sql);
    expect(sql.some((s) => s.includes("DROP DEFAULT"))).toBe(false);
  });

  test("gate quadrant plain→plain: DROP DEFAULT is emitted", () => {
    const sql = plan(
      base([bareCol("integer", {})]),
      base([bareCol("bigint", {})]),
    ).actions.map((a) => a.sql);
    expect(sql.some((s) => s.includes("DROP DEFAULT"))).toBe(true);
  });

  test("gate quadrant plain→identity: no DROP DEFAULT (ADD IDENTITY already ran)", () => {
    // A plain column gains identity AND changes type in one plan. `identity` <
    // `type`, so `ADD … AS IDENTITY` executes first; a DROP DEFAULT gated on the
    // SOURCE side would then hit an identity column and PostgreSQL rejects it
    // ("column \"id\" of relation \"t\" is an identity column").
    const sql = plan(
      base([bareCol("integer", {})]),
      base([colFact({ maxValue: "9223372036854775807" }, "bigint")]),
    ).actions.map((a) => a.sql);
    expect(
      sql.some((s) => s.includes("ADD GENERATED ALWAYS AS IDENTITY")),
    ).toBe(true);
    expect(sql.some((s) => s.includes("DROP DEFAULT"))).toBe(false);
  });

  test("gate quadrant identity→plain: DROP DEFAULT is emitted (harmless no-op)", () => {
    // DROP IDENTITY runs first (identity < type), so by the time the type action
    // executes the column is plain and DROP DEFAULT is a valid no-op.
    const sql = plan(
      base([colFact({})]),
      base([bareCol("bigint", {})]),
    ).actions.map((a) => a.sql);
    const dropIdentityAt = sql.indexOf(
      `ALTER TABLE "app"."t" ALTER COLUMN "id" DROP IDENTITY`,
    );
    const dropDefaultAt = sql.indexOf(
      `ALTER TABLE "app"."t" ALTER COLUMN "id" DROP DEFAULT`,
    );
    expect(dropIdentityAt).toBeGreaterThanOrEqual(0);
    expect(dropDefaultAt).toBeGreaterThan(dropIdentityAt);
  });
});
