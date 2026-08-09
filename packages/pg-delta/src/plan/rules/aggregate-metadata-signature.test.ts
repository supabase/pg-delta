/**
 * COMMENT ON / SECURITY LABEL ON an ordered-set (or hypothetical-set) aggregate
 * must address it with the `direct ORDER BY ordered` signature, exactly like the
 * CREATE / DROP / ALTER AGGREGATE rules do via `aggSig`. Before this fix the
 * metadata target rendered the flat comma list of every argument type, which
 * PostgreSQL rejects at apply for an ordered-set aggregate ("function ... does
 * not exist"). Pure rule/diff level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../../core/fact.ts";
import type { StableId } from "../../core/stable-id.ts";
import { plan } from "../plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};

// ordered-set aggregate: proargtypes = [direct..., ordered...]; numDirectArgs
// splits them, aggKind 'o' selects the ORDER BY rendering.
const orderedSetAggId: StableId = {
  kind: "aggregate",
  schema: "app",
  name: "my_pd",
  args: ["double precision", "double precision"],
};
const orderedSetAggFact: Fact = {
  id: orderedSetAggId,
  parent: { kind: "schema", name: "app" },
  payload: {
    aggKind: "o",
    numDirectArgs: 1,
    sfunc: "pg_catalog.ordered_set_transition",
    stype: "internal",
    finalfunc: "pg_catalog.percentile_disc_final",
    finalfuncExtra: true,
    finalfuncModify: "r",
    mfinalfuncModify: "r",
    sspace: 0,
    msspace: 0,
    initcond: null,
    minitcond: null,
    combinefunc: null,
    serialfunc: null,
    deserialfunc: null,
    msfunc: null,
    minvfunc: null,
    mstype: null,
    mfinalfunc: null,
    mfinalfuncExtra: false,
    sortop: null,
    parallel: "u",
  },
};

const commentFact: Fact = {
  id: { kind: "comment", target: orderedSetAggId },
  parent: orderedSetAggId,
  payload: { text: "percentile disc" },
};
const securityLabelFact: Fact = {
  id: { kind: "securityLabel", target: orderedSetAggId, provider: "dummy" },
  parent: orderedSetAggId,
  payload: { label: "secret" },
};

const base = (extra: Fact[]) => buildFactBase([schemaFact, ...extra], []);

describe("ordered-set aggregate metadata signature", () => {
  test("COMMENT ON addresses the aggregate with ORDER BY", () => {
    const sql = plan(
      base([orderedSetAggFact]),
      base([orderedSetAggFact, commentFact]),
    )
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).toContain(
      `COMMENT ON AGGREGATE "app"."my_pd"(double precision ORDER BY double precision) IS 'percentile disc'`,
    );
  });

  test("SECURITY LABEL addresses the aggregate with ORDER BY", () => {
    const sql = plan(
      base([orderedSetAggFact]),
      base([orderedSetAggFact, securityLabelFact]),
    )
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).toContain(
      `ON AGGREGATE "app"."my_pd"(double precision ORDER BY double precision) IS 'secret'`,
    );
  });
});
