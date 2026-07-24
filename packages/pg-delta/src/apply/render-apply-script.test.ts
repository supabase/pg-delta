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
    expect(
      renderApplyScript(planWithMixedSegments(), {
        lockTimeoutMs: 1_000,
        statementTimeoutMs: 2_000,
      }),
    ).toMatchInlineSnapshot(`
      "-- pg-delta schema apply --dry-run
      -- Execute statements one at a time, in order, on one database session.
      -- Stop on the first error and preserve autocommit outside BEGIN/COMMIT blocks.
      -- Do not submit this as one multi-statement request or wrap it in one transaction.

      BEGIN;
      SET LOCAL lock_timeout = 1000;
      SET LOCAL statement_timeout = 2000;
      SET LOCAL search_path = pg_catalog;
      SET LOCAL check_function_bodies = off;
      CREATE TABLE public.widgets (id integer);
      COMMIT;

      SET lock_timeout = 1000;
      SET statement_timeout = 2000;
      SET search_path = pg_catalog;
      SET check_function_bodies = off;
      CREATE INDEX CONCURRENTLY widgets_id_idx ON public.widgets (id);
      RESET ALL;

      BEGIN;
      SET LOCAL lock_timeout = 1000;
      SET LOCAL statement_timeout = 2000;
      SET LOCAL search_path = pg_catalog;
      SET LOCAL check_function_bodies = off;
      ALTER TABLE public.widgets ADD COLUMN label text;
      COMMIT;
      "
    `);
  });

  test("keeps commitBoundaryAfter actions behind a committed boundary", () => {
    const plan = planWithMixedSegments();
    plan.actions = [
      action("ALTER TYPE public.mood ADD VALUE 'ok'", "commitBoundaryAfter"),
      action("ALTER TABLE public.widgets ADD COLUMN mood public.mood"),
    ];

    expect(renderApplyScript(plan)).toContain(
      "ALTER TYPE public.mood ADD VALUE 'ok';\nCOMMIT;\n\nBEGIN;\nSET LOCAL search_path",
    );
  });

  test("resets a non-transactional segment even without a preamble", () => {
    const plan = planWithMixedSegments();
    plan.preamble = [];
    plan.actions = [action("VACUUM public.widgets", "nonTransactional")];

    expect(renderApplyScript(plan)).toEndWith(
      "\n\nVACUUM public.widgets;\nRESET ALL;\n",
    );
  });

  test("renders an empty plan as an empty script", () => {
    const plan = planWithMixedSegments();
    plan.actions = [];

    expect(renderApplyScript(plan)).toBe("");
  });
});
