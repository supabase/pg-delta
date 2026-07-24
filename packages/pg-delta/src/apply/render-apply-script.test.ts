import { describe, expect, test } from "bun:test";
import type { Action, Plan } from "../plan/plan.ts";
import { renderApplyScript } from "./render-apply-script.ts";

function action(
  sql: string,
  transactionality: Action["transactionality"] = "transactional",
): Action {
  return {
    sql,
    verb: "create",
    produces: [],
    consumes: [],
    destroys: [],
    releases: [],
    transactionality,
    lockClass: "none",
    newSegmentBefore: false,
    dataLoss: "none",
    rewriteRisk: false,
  } as Action;
}

function planWithMixedSegments(): Plan {
  return {
    formatVersion: 1,
    engineVersion: "test",
    source: { fingerprint: "source" },
    target: { fingerprint: "target" },
    preamble: [
      { name: "search_path", value: "pg_catalog" },
      { name: "check_function_bodies", value: "off" },
    ],
    deltas: [],
    filteredDeltas: [],
    renameCandidates: [],
    actions: [
      action("CREATE TABLE public.widgets (id integer)"),
      action(
        "CREATE INDEX CONCURRENTLY widgets_id_idx ON public.widgets (id)",
        "nonTransactional",
      ),
      action("ALTER TABLE public.widgets ADD COLUMN label text"),
    ],
    safetyReport: {
      destructiveActions: 0,
      rewriteRiskActions: 0,
      nonTransactionalActions: 1,
      lockClasses: {},
    },
  } as Plan;
}

describe("renderApplyScript", () => {
  test("renders the exact apply transaction framing and full preamble", () => {
    expect(renderApplyScript(planWithMixedSegments())).toMatchInlineSnapshot(`
      "BEGIN;
      SET LOCAL search_path = pg_catalog;
      SET LOCAL check_function_bodies = off;
      CREATE TABLE public.widgets (id integer);
      COMMIT;

      SET search_path = pg_catalog;
      SET check_function_bodies = off;
      CREATE INDEX CONCURRENTLY widgets_id_idx ON public.widgets (id);
      RESET ALL;

      BEGIN;
      SET LOCAL search_path = pg_catalog;
      SET LOCAL check_function_bodies = off;
      ALTER TABLE public.widgets ADD COLUMN label text;
      COMMIT;
      "
    `);
  });
});
