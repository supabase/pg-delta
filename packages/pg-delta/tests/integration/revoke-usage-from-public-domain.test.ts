import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import type { Pool } from "pg";
import { createPlan } from "../../src/core/plan/create.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

const DOMAIN = "test_schema.secret_dom";

async function generatedSql(main: Pool, branch: Pool): Promise<string[]> {
  const planResult = await createPlan(main, branch, {});
  return planResult ? flattenPlanStatements(planResult.plan) : [];
}

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`revoke usage from PUBLIC on domain (pg${pgVersion})`, () => {
    test(
      "control: REVOKE USAGE ... FROM <named role> is emitted",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;
            CREATE ROLE app_user;
            CREATE DOMAIN ${DOMAIN} AS int;
            GRANT USAGE ON DOMAIN ${DOMAIN} TO app_user;
          `,
          testSql: dedent`REVOKE USAGE ON DOMAIN ${DOMAIN} FROM app_user;`,
          expectedSqlTerms: [
            "REVOKE ALL ON DOMAIN test_schema.secret_dom FROM app_user",
          ],
        });
      }),
    );

    test(
      "create: preserves REVOKE USAGE ... FROM PUBLIC for a new domain",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`CREATE SCHEMA test_schema;`,
          testSql: dedent`
            CREATE DOMAIN ${DOMAIN} AS int;
            REVOKE USAGE ON DOMAIN ${DOMAIN} FROM PUBLIC;
          `,
          assertSqlStatements: (sqlStatements) => {
            expect(
              sqlStatements.some((s) => s.startsWith("CREATE DOMAIN")),
            ).toBe(true);
            expect(sqlStatements).toContain(
              "REVOKE ALL ON DOMAIN test_schema.secret_dom FROM PUBLIC",
            );
          },
        });
      }),
    );

    test(
      "alter: emits REVOKE USAGE ... FROM PUBLIC for an existing domain",
      withDbIsolated(pgVersion, async (db) => {
        const { main, branch } = db;
        const setup = dedent`
          CREATE SCHEMA test_schema;
          CREATE DOMAIN ${DOMAIN} AS int;
        `;
        await main.query(setup);
        await branch.query(setup);
        await branch.query(
          dedent`REVOKE USAGE ON DOMAIN ${DOMAIN} FROM PUBLIC;`,
        );

        const sql = await generatedSql(main, branch);
        expect(sql.join("\n")).toContain("FROM PUBLIC");
      }),
    );
  });
}
