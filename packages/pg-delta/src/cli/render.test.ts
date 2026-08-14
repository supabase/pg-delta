/**
 * renderPlan (pure): reads a Plan artifact and produces one or more
 * dbmate-friendly SQL file bodies, splitting on the SAME segment boundaries
 * `apply()` uses at execution time (src/apply/apply.ts::segmentActions), so
 * rendered files reflect exactly how the plan would be executed.
 */
import { describe, expect, test } from "bun:test";
import { stampPlanId, type Action, type Plan } from "../plan/plan.ts";
import { renderPlan } from "./render.ts";

function action(overrides: Partial<Action>): Action {
  return {
    sql: "SELECT 1",
    verb: "create",
    produces: [],
    consumes: [],
    destroys: [],
    releases: [],
    transactionality: "transactional",
    lockClass: "none",
    newSegmentBefore: false,
    dataLoss: "none",
    rewriteRisk: false,
    ...overrides,
  } as Action;
}

function makePlan(overrides: Partial<Plan>): Plan {
  return stampPlanId({
    formatVersion: 1,
    engineVersion: "test",
    source: { fingerprint: "a" },
    target: { fingerprint: "b" },
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
    ...overrides,
  });
}

describe("renderPlan", () => {
  test("single segment: one file with preamble + statements", () => {
    const plan = makePlan({
      preamble: [{ name: "check_function_bodies", value: "off" }],
      actions: [
        action({ sql: "CREATE SCHEMA foo" }),
        action({ sql: "CREATE TABLE foo.bar (id integer);" }),
      ],
    });

    const result = renderPlan(plan, { allowDrops: false });

    expect(result.changes).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.suffix).toBeNull();
    expect(result.files[0]!.transactional).toBe(true);
    expect(result.files[0]!.actionCount).toBe(2);
    expect(result.files[0]!.contents).toMatchInlineSnapshot(`
      "set local check_function_bodies = off;

      CREATE SCHEMA foo;

      CREATE TABLE foo.bar (id integer);
      "
    `);
  });

  test("multi segment: nonTransactional action splits into _1/_2 with transaction=false header", () => {
    const plan = makePlan({
      preamble: [{ name: "check_function_bodies", value: "off" }],
      actions: [
        action({ sql: "CREATE TABLE foo (id integer)" }),
        action({
          sql: "CREATE INDEX CONCURRENTLY foo_idx ON foo (id)",
          transactionality: "nonTransactional",
        }),
      ],
    });

    const result = renderPlan(plan, { allowDrops: false });

    expect(result.changes).toBe(true);
    expect(result.files).toHaveLength(2);

    expect(result.files[0]!.suffix).toBe("_1");
    expect(result.files[0]!.transactional).toBe(true);
    expect(result.files[0]!.actionCount).toBe(1);
    expect(result.files[0]!.contents).toMatchInlineSnapshot(`
      "set local check_function_bodies = off;

      CREATE TABLE foo (id integer);
      "
    `);

    expect(result.files[1]!.suffix).toBe("_2");
    expect(result.files[1]!.transactional).toBe(false);
    expect(result.files[1]!.actionCount).toBe(1);
    expect(result.files[1]!.contents).toMatchInlineSnapshot(`
      "-- pg-delta: transaction=false
      set check_function_bodies = off;

      CREATE INDEX CONCURRENTLY foo_idx ON foo (id);

      reset all;
      "
    `);
  });

  test("commitBoundaryAfter closes a segment, starting a new one after it", () => {
    const plan = makePlan({
      preamble: [],
      actions: [
        action({
          sql: "ALTER TYPE color ADD VALUE 'blue'",
          transactionality: "commitBoundaryAfter",
        }),
        action({ sql: "CREATE TABLE uses_color (c color)" }),
      ],
    });

    const result = renderPlan(plan, { allowDrops: false });

    expect(result.files).toHaveLength(2);
    expect(result.files[0]!.suffix).toBe("_1");
    expect(result.files[0]!.contents).toMatchInlineSnapshot(`
      "ALTER TYPE color ADD VALUE 'blue';
      "
    `);
    expect(result.files[1]!.suffix).toBe("_2");
    expect(result.files[1]!.contents).toMatchInlineSnapshot(`
      "CREATE TABLE uses_color (c color);
      "
    `);
  });

  test("drop action without allowDrops throws naming the offending SQL", () => {
    const plan = makePlan({
      actions: [action({ sql: "DROP TABLE foo", verb: "drop" })],
    });

    expect(() => renderPlan(plan, { allowDrops: false })).toThrow(
      /DROP TABLE foo/,
    );
  });

  test("drop action with allowDrops renders normally", () => {
    const plan = makePlan({
      actions: [action({ sql: "DROP TABLE foo", verb: "drop" })],
    });

    const result = renderPlan(plan, { allowDrops: true });

    expect(result.changes).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.contents).toMatchInlineSnapshot(`
      "DROP TABLE foo;
      "
    `);
  });

  test("destructive non-drop action without allowDrops throws (gates on dataLoss, not just verb)", () => {
    // an enum value-set migration rewrites dependent columns: verb `alter`,
    // but dataLoss "destructive". The verb-only guard would let it through.
    const plan = makePlan({
      actions: [
        action({
          sql: "ALTER TABLE foo ALTER COLUMN c TYPE new_enum USING c::text::new_enum",
          verb: "alter",
          dataLoss: "destructive",
        }),
      ],
    });

    expect(() => renderPlan(plan, { allowDrops: false })).toThrow(
      /destructive action/,
    );
    // and it renders once the caller opts in
    expect(renderPlan(plan, { allowDrops: true }).files).toHaveLength(1);
  });

  test("non-destructive drop-verb action (e.g. cron unschedule) is still gated by allowDrops", () => {
    // conservative union: a `drop`-verb action stays gated even when dataLoss
    // is "none", so nothing that reads as a drop slips out silently.
    const plan = makePlan({
      actions: [
        action({
          sql: "select cron.unschedule('nightly')",
          verb: "drop",
          dataLoss: "none",
        }),
      ],
    });

    expect(() => renderPlan(plan, { allowDrops: false })).toThrow(
      /drop action/,
    );
    expect(renderPlan(plan, { allowDrops: true }).files).toHaveLength(1);
  });

  test("empty plan: no changes, no files", () => {
    const plan = makePlan({ actions: [] });

    const result = renderPlan(plan, { allowDrops: false });

    expect(result.changes).toBe(false);
    expect(result.files).toHaveLength(0);
  });

  test("semicolon normalization: with and without trailing ; both yield exactly one", () => {
    const plan = makePlan({
      actions: [
        action({ sql: "CREATE SCHEMA already_terminated;" }),
        action({ sql: "CREATE SCHEMA not_terminated" }),
        action({ sql: "CREATE SCHEMA trailing_whitespace;   \n\n" }),
      ],
    });

    const result = renderPlan(plan, { allowDrops: false });

    expect(result.files[0]!.contents).toMatchInlineSnapshot(`
      "CREATE SCHEMA already_terminated;

      CREATE SCHEMA not_terminated;

      CREATE SCHEMA trailing_whitespace;
      "
    `);
  });
});
