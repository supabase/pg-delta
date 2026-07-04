/**
 * Integration tests for the declarative-apply command.
 *
 * Exports a declarative schema from a "branch" database, writes it to temp
 * SQL files, then applies it to a fresh "main" database using the round-based
 * engine. Verifies the resulting schema matches the original.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { loadDeclarativeSchema } from "../../src/core/declarative-apply/discover-sql.ts";
import { applyDeclarativeSchema } from "../../src/core/declarative-apply/index.ts";
import { exportDeclarativeSchema } from "../../src/core/export/index.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { sortChanges } from "../../src/core/sort/sort-changes.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";

/**
 * Helper: export declarative schema from branch DB, write to temp dir,
 * then apply to main DB using loadDeclarativeSchema + applyDeclarativeSchema (content-based).
 */
async function testDeclarativeApply(options: {
  mainSession: import("pg").Pool;
  branchSession: import("pg").Pool;
  initialSetup?: string;
  testSql: string;
}) {
  const { mainSession, branchSession, initialSetup, testSql } = options;

  // 1. Set up initial schema in branch (and optionally main)
  const sessionConfig = ["SET LOCAL client_min_messages = error"];
  if (initialSetup) {
    await mainSession.query([...sessionConfig, initialSetup].join(";\n\n"));
    await branchSession.query([...sessionConfig, initialSetup].join(";\n\n"));
  }

  // Execute the test SQL in branch only
  await branchSession.query([...sessionConfig, testSql].join(";\n\n"));

  // 2. Export declarative schema from (main → branch)
  const planResult = await createPlan(mainSession, branchSession);
  if (!planResult) {
    throw new Error("No changes detected - cannot test declarative apply");
  }

  const output = exportDeclarativeSchema(planResult);

  // 3. Write SQL files to a temp directory
  const tempDir = path.join(
    tmpdir(),
    `pgdelta-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tempDir, { recursive: true });

  try {
    for (const file of output.files) {
      const filePath = path.join(tempDir, file.path);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, file.sql);
    }

    // 4. Load content via discover + read (CLI-style), then apply via content-based API
    const content = await loadDeclarativeSchema(tempDir);
    const result = await applyDeclarativeSchema({
      content,
      pool: mainSession,
      maxRounds: 50,
      validateFunctionBodies: true,
      disableCheckFunctionBodies: true,
    });

    const { apply: applyResult } = result;

    // 5. Verify the result
    expect(applyResult.status).toBe("success");
    expect(applyResult.totalApplied).toBeGreaterThan(0);

    // 6. Verify the schema matches by diffing main vs branch
    const mainCatalog = await extractCatalog(mainSession);
    const branchCatalog = await extractCatalog(branchSession);
    const remainingChanges = diffCatalogs(mainCatalog, branchCatalog);
    const sortedRemaining = sortChanges(
      { mainCatalog, branchCatalog },
      remainingChanges,
    );

    // Verify no remaining differences between main and branch
    expect(sortedRemaining).toHaveLength(0);

    return {
      apply: applyResult,
      diagnostics: result.diagnostics,
      totalStatements: result.totalStatements,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`declarative-apply round-based (pg${pgVersion})`, () => {
    test(
      "simple table with index",
      withDb(pgVersion, async (db) => {
        const result = await testDeclarativeApply({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
            CREATE TABLE test_schema.users (
              id integer PRIMARY KEY,
              name text NOT NULL
            );
            CREATE INDEX users_name_idx ON test_schema.users (name);
          `,
        });

        // Should complete in a small number of rounds (pg-topo orders well)
        expect(result.apply.totalRounds).toBeLessThanOrEqual(3);
      }),
    );

    test(
      "multiple schemas with cross-references",
      withDb(pgVersion, async (db) => {
        await testDeclarativeApply({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `
            CREATE SCHEMA schema_a;
            CREATE SCHEMA schema_b;
            CREATE TABLE schema_a.parent (id integer PRIMARY KEY);
            CREATE TABLE schema_b.child (
              id integer PRIMARY KEY,
              parent_id integer REFERENCES schema_a.parent(id)
            );
          `,
        });
      }),
    );

    test(
      "cyclic input surfaces the cycle instead of silently dropping statements",
      withDb(pgVersion, async (db) => {
        // Two tables with mutual inline foreign keys form a dependency cycle
        // pg-topo cannot linearize. @supabase/pg-topo's total-order contract
        // guarantees the cycle members still reach the applier (every input
        // statement appears in `ordered` exactly once) rather than being
        // dropped, so the unbreakable cycle fails loudly as "stuck" instead of
        // reporting a partial success. Regression guard for the total-order
        // change: before it, the two tables were absent from `ordered`, so this
        // reported status "success" with only the schema applied.
        const sql = [
          "CREATE SCHEMA cyc",
          "CREATE TABLE cyc.a (id integer PRIMARY KEY, b_id integer REFERENCES cyc.b (id))",
          "CREATE TABLE cyc.b (id integer PRIMARY KEY, a_id integer REFERENCES cyc.a (id))",
        ].join(";\n");

        const result = await applyDeclarativeSchema({
          content: [{ filePath: "schema.sql", sql }],
          pool: db.main,
          maxRounds: 10,
          validateFunctionBodies: false,
          disableCheckFunctionBodies: true,
        });

        // total-order: all three input statements reach the applier.
        expect(result.totalStatements).toBe(3);
        // pg-topo still reports the cycle as a diagnostic.
        expect(
          result.diagnostics.some((d) => d.code === "CYCLE_DETECTED"),
        ).toBe(true);
        // The cycle fails loudly rather than reporting a partial success.
        expect(result.apply.status).toBe("stuck");
        // Only CREATE SCHEMA applies; both cyclic tables are attempted and
        // reported stuck (not silently skipped).
        expect(result.apply.totalApplied).toBe(1);
        expect(result.apply.stuckStatements).toHaveLength(2);
      }),
    );

    test(
      "views and functions",
      withDb(pgVersion, async (db) => {
        await testDeclarativeApply({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
            CREATE TABLE test_schema.users (id integer, name text);
            CREATE VIEW test_schema.user_names AS
              SELECT name FROM test_schema.users;
            CREATE FUNCTION test_schema.get_user_count()
              RETURNS integer
              AS $$ SELECT count(*)::integer FROM test_schema.users; $$
              LANGUAGE sql;
          `,
        });
      }),
    );

    test(
      "complex dependency chain resolves across rounds",
      withDb(pgVersion, async (db) => {
        await testDeclarativeApply({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `
            CREATE SCHEMA app;
            CREATE TYPE app.user_status AS ENUM ('active', 'inactive');
            CREATE SEQUENCE app.users_id_seq;
            CREATE TABLE app.users (
              id integer DEFAULT nextval('app.users_id_seq') PRIMARY KEY,
              name text NOT NULL,
              status app.user_status DEFAULT 'active'
            );
            ALTER SEQUENCE app.users_id_seq OWNED BY app.users.id;
            CREATE TABLE app.posts (
              id integer PRIMARY KEY,
              author_id integer REFERENCES app.users(id),
              title text
            );
            CREATE INDEX posts_author_idx ON app.posts (author_id);
            CREATE VIEW app.user_posts AS
              SELECT u.name, p.title
              FROM app.users u
              JOIN app.posts p ON p.author_id = u.id;
          `,
        });
      }),
    );
  });
}
