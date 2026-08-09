/**
 * CREATE AGGREGATE must reproduce every pg_aggregate option, not just
 * SFUNC/STYPE/FINALFUNC/INITCOND/HYPOTHETICAL (PR #299 review,
 * supabase/pg-toolbelt). Before this, the extra options (COMBINEFUNC,
 * SERIALFUNC, DESERIALFUNC, the moving-aggregate set, FINALFUNC_MODIFY,
 * FINALFUNC_EXTRA, SORTOP, PARALLEL) were never captured/rendered, so an
 * aggregate that differed only in those options was recreated wrong (or, since
 * they were absent from the payload, not recreated at all). Pure rule/diff
 * level — no DB. Aggregates are drop+create, so each option must render in the
 * CREATE.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};
const aggId: StableId = {
  kind: "aggregate",
  schema: "app",
  name: "agg",
  args: ["integer"],
};
const aggFact = (extra: Record<string, unknown>): Fact => ({
  id: aggId,
  parent: { kind: "schema", name: "app" },
  payload: {
    aggKind: "n",
    numDirectArgs: 0,
    sfunc: "app.sf",
    stype: "integer",
    finalfunc: null,
    initcond: null,
    combinefunc: null,
    serialfunc: null,
    deserialfunc: null,
    msfunc: null,
    minvfunc: null,
    mstype: null,
    mfinalfunc: null,
    minitcond: null,
    finalfuncExtra: false,
    mfinalfuncExtra: false,
    finalfuncModify: "r",
    mfinalfuncModify: "r",
    sspace: 0,
    msspace: 0,
    sortop: null,
    parallel: "u",
    ...extra,
  },
});
const base = (extra: Fact[]) => buildFactBase([schemaFact, ...extra], []);

describe("CREATE AGGREGATE option rendering", () => {
  const create = (extra: Record<string, unknown>): string =>
    plan(base([]), base([aggFact(extra)]))
      .actions.map((a) => a.sql)
      .join("\n");

  test("renders COMBINEFUNC / SERIALFUNC / DESERIALFUNC", () => {
    const sql = create({
      combinefunc: "app.cf",
      serialfunc: "app.serf",
      deserialfunc: "app.deserf",
    });
    expect(sql).toContain("COMBINEFUNC = app.cf");
    expect(sql).toContain("SERIALFUNC = app.serf");
    expect(sql).toContain("DESERIALFUNC = app.deserf");
  });

  test("renders the moving-aggregate set", () => {
    const sql = create({
      msfunc: "app.msf",
      minvfunc: "app.minvf",
      mstype: "integer",
      mfinalfunc: "app.mff",
      minitcond: "0",
      msspace: 16,
    });
    expect(sql).toContain("MSFUNC = app.msf");
    expect(sql).toContain("MINVFUNC = app.minvf");
    expect(sql).toContain("MSTYPE = integer");
    expect(sql).toContain("MFINALFUNC = app.mff");
    expect(sql).toContain("MINITCOND = '0'");
    expect(sql).toContain("MSSPACE = 16");
  });

  test("renders FINALFUNC_EXTRA / FINALFUNC_MODIFY / SSPACE", () => {
    const sql = create({
      finalfunc: "app.ff",
      finalfuncExtra: true,
      finalfuncModify: "w",
      sspace: 64,
    });
    expect(sql).toContain("FINALFUNC = app.ff");
    expect(sql).toContain("FINALFUNC_EXTRA");
    expect(sql).toContain("FINALFUNC_MODIFY = READ_WRITE");
    expect(sql).toContain("SSPACE = 64");
  });

  test("renders SORTOP and PARALLEL", () => {
    const sql = create({ sortop: "OPERATOR(pg_catalog.>)", parallel: "s" });
    expect(sql).toContain("SORTOP = OPERATOR(pg_catalog.>)");
    expect(sql).toContain("PARALLEL = SAFE");
  });

  test("default FINALFUNC_MODIFY / PARALLEL are omitted", () => {
    const sql = create({ finalfunc: "app.ff" });
    expect(sql).not.toContain("FINALFUNC_MODIFY");
    expect(sql).not.toContain("PARALLEL");
  });
});
