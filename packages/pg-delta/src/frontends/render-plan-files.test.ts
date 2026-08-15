/**
 * renderPlanFiles (pure): reads a Plan artifact and produces one or more
 * dbmate-friendly SQL file bodies, splitting on the SAME segment boundaries
 * `apply()` uses at execution time (src/apply/apply.ts::segmentActions), so
 * rendered files reflect exactly how the plan would be executed.
 */
import { describe, expect, test } from "bun:test";
import { stampPlanId, type Action, type Plan } from "../plan/plan.ts";
import { renderPlanFiles } from "./render-plan-files.ts";

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

describe("renderPlanFiles", () => {
  test("single segment: one file with preamble + statements", () => {
    const plan = makePlan({
      preamble: [{ name: "check_function_bodies", value: "off" }],
      actions: [
        action({ sql: "CREATE SCHEMA foo" }),
        action({ sql: "CREATE TABLE foo.bar (id integer);" }),
      ],
    });

    const result = renderPlanFiles(plan, { allowDrops: false });

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

    const result = renderPlanFiles(plan, { allowDrops: false });

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

    const result = renderPlanFiles(plan, { allowDrops: false });

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

    expect(() => renderPlanFiles(plan, { allowDrops: false })).toThrow(
      /DROP TABLE foo/,
    );
  });

  test("drop action with allowDrops renders normally", () => {
    const plan = makePlan({
      actions: [action({ sql: "DROP TABLE foo", verb: "drop" })],
    });

    const result = renderPlanFiles(plan, { allowDrops: true });

    expect(result.changes).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.contents).toMatchInlineSnapshot(`
      "DROP TABLE foo;
      "
    `);
  });

  test("destructive non-drop action without allowDrops throws (gates on dataLoss, not just verb)", () => {
    const plan = makePlan({
      actions: [
        action({
          sql: "ALTER TABLE foo ALTER COLUMN c TYPE new_enum USING c::text::new_enum",
          verb: "alter",
          dataLoss: "destructive",
        }),
      ],
    });

    expect(() => renderPlanFiles(plan, { allowDrops: false })).toThrow(
      /destructive action/,
    );
    expect(renderPlanFiles(plan, { allowDrops: true }).files).toHaveLength(1);
  });

  test("non-destructive drop-verb action (e.g. cron unschedule) is still gated by allowDrops", () => {
    const plan = makePlan({
      actions: [
        action({
          sql: "select cron.unschedule('nightly')",
          verb: "drop",
          dataLoss: "none",
        }),
      ],
    });

    expect(() => renderPlanFiles(plan, { allowDrops: false })).toThrow(
      /drop action/,
    );
    expect(renderPlanFiles(plan, { allowDrops: true }).files).toHaveLength(1);
  });

  test("refuses contradictory destruction metadata even when destructive rendering is allowed", () => {
    const cases: Array<{ sql: string; destroys: Action["destroys"] }> = [
      {
        sql: "ALTER TABLE app.records DROP COLUMN secret",
        destroys: [
          {
            kind: "column",
            schema: "app",
            table: "records",
            name: "secret",
          },
        ],
      },
      {
        sql: "DROP TABLE app.records",
        destroys: [{ kind: "table", schema: "app", name: "records" }],
      },
      {
        sql: "DROP MATERIALIZED VIEW app.summary",
        destroys: [
          { kind: "materializedView", schema: "app", name: "summary" },
        ],
      },
    ];

    for (const { sql, destroys } of cases) {
      const plan = makePlan({
        actions: [action({ sql, verb: "alter", destroys, dataLoss: "none" })],
      });
      expect(() => renderPlanFiles(plan, { allowDrops: true })).toThrow(
        /destroys intrinsically data-bearing object .*dataLoss:none/,
      );
    }
  });

  test("renders an accepted same-action rename without treating it as destruction", () => {
    const from = { kind: "table" as const, schema: "app", name: "old_records" };
    const to = { kind: "table" as const, schema: "app", name: "records" };
    const plan = makePlan({
      acceptedRenames: [{ from, to }],
      actions: [
        action({
          sql: "ALTER TABLE app.old_records RENAME TO records",
          verb: "alter",
          destroys: [from],
          produces: [to],
          dataLoss: "none",
        }),
      ],
    });

    expect(renderPlanFiles(plan, { allowDrops: false }).files).toHaveLength(1);
  });

  test("transactional segment scopes preamble with SET LOCAL (dies at COMMIT, no session leak)", () => {
    const plan = makePlan({
      preamble: [
        { name: "search_path", value: "pg_catalog" },
        { name: "check_function_bodies", value: "off" },
      ],
      actions: [action({ sql: "CREATE SCHEMA foo" })],
    });

    const [file] = renderPlanFiles(plan, { allowDrops: false }).files;

    // a transactional file runs inside dbmate's BEGIN/COMMIT, so SET LOCAL
    // reverts at COMMIT — a reused runner session does not inherit the settings.
    expect(file!.transactional).toBe(true);
    expect(file!.contents).toContain("set local check_function_bodies = off;");
    // search_path is NOT pinned in rendered files: the DDL is already fully
    // qualified so the pin is redundant, and a third-party runner (dbmate)
    // executes its own UNqualified bookkeeping (INSERT INTO schema_migrations)
    // in the same transaction — pinning search_path=pg_catalog would misresolve
    // it to pg_catalog.schema_migrations and break the migration.
    expect(file!.contents).not.toContain("search_path");
  });

  test("non-transactional segment resets the preamble at end of file (no session leak)", () => {
    const plan = makePlan({
      preamble: [
        { name: "search_path", value: "pg_catalog" },
        { name: "check_function_bodies", value: "off" },
      ],
      actions: [
        action({
          sql: "CREATE INDEX CONCURRENTLY foo_idx ON foo (id)",
          transactionality: "nonTransactional",
        }),
      ],
    });

    const [file] = renderPlanFiles(plan, { allowDrops: false }).files;

    // SET LOCAL is a no-op outside a transaction, so a non-transactional file
    // must use plain SET and RESET at the end so the settings do not persist on
    // the runner's session (mirrors apply()'s RESET ALL after standalone DDL).
    // search_path is filtered out (see transactional test above), so only
    // check_function_bodies is set — but RESET ALL still cleans it up.
    expect(file!.transactional).toBe(false);
    expect(file!.contents).toContain("set check_function_bodies = off;");
    expect(file!.contents).not.toContain("search_path");
    expect(file!.contents).not.toContain("set local");
    expect(file!.contents.trimEnd().endsWith("reset all;")).toBe(true);
  });

  test("does not emit any search_path preamble line (fully-qualified DDL makes it redundant; third-party runners like dbmate share the transaction with unqualified bookkeeping)", () => {
    const plan = makePlan({
      preamble: [
        { name: "search_path", value: "pg_catalog" },
        { name: "check_function_bodies", value: "off" },
      ],
      actions: [action({ sql: "CREATE TABLE public.widgets (id integer)" })],
    });

    const [file] = renderPlanFiles(plan, { allowDrops: false }).files;

    expect(file!.contents).not.toContain("search_path");
    expect(file!.contents).toContain("set local check_function_bodies = off;");
    // the redundancy claim: the create is already schema-qualified.
    expect(file!.contents).toContain("CREATE TABLE public.widgets");
  });

  test("empty plan: no changes, no files", () => {
    const plan = makePlan({ actions: [] });

    const result = renderPlanFiles(plan, { allowDrops: false });

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

    const result = renderPlanFiles(plan, { allowDrops: false });

    expect(result.files[0]!.contents).toMatchInlineSnapshot(`
      "CREATE SCHEMA already_terminated;

      CREATE SCHEMA not_terminated;

      CREATE SCHEMA trailing_whitespace;
      "
    `);
  });
});
