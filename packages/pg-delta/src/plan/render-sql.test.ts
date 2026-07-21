/**
 * renderPlanSql turns a plan (its preamble + ordered actions) into a single
 * replayable .sql script — the same statement order apply() executes, with the
 * preamble emitted as leading SET statements. This is what the Supabase
 * baseline-fixture pipeline persists and what `applySupabaseBaseInit` replays.
 */
import { describe, expect, test } from "bun:test";
import { renderPlanSql } from "./render-sql.ts";

describe("renderPlanSql", () => {
  test("emits preamble SETs then each action, semicolon-terminated", () => {
    const sql = renderPlanSql({
      preamble: [{ name: "check_function_bodies", value: "off" }],
      actions: [
        { sql: "CREATE SCHEMA auth AUTHORIZATION supabase_admin" },
        { sql: 'GRANT USAGE ON SCHEMA auth TO "anon"' },
      ],
    });
    expect(sql).toMatchInlineSnapshot(`
      "SET check_function_bodies = off;

      CREATE SCHEMA auth AUTHORIZATION supabase_admin;

      GRANT USAGE ON SCHEMA auth TO "anon";

      RESET check_function_bodies;
      "
    `);
  });

  test("does not double a trailing semicolon already present on an action", () => {
    const sql = renderPlanSql({
      preamble: [],
      actions: [{ sql: "CREATE SCHEMA foo;" }],
    });
    expect(sql).toBe("CREATE SCHEMA foo;\n");
  });

  test("trims trailing whitespace/newlines before terminating", () => {
    const sql = renderPlanSql({
      preamble: [],
      actions: [{ sql: "CREATE SCHEMA foo\n" }],
    });
    expect(sql).toBe("CREATE SCHEMA foo;\n");
  });

  test("returns an empty string for an empty plan (no preamble, no actions)", () => {
    expect(renderPlanSql({ preamble: [], actions: [] })).toBe("");
  });
});
