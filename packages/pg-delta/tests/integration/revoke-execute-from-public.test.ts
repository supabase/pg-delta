import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import type { Pool } from "pg";
import { createPlan } from "../../src/core/plan/create.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

const FN = "public.secret_fn()";

async function generatedSql(main: Pool, branch: Pool): Promise<string[]> {
  const planResult = await createPlan(main, branch, {});
  return planResult ? flattenPlanStatements(planResult.plan) : [];
}

// probe_nopriv has no explicit grants, so it can EXECUTE only via PUBLIC.
async function publicCanExecute(db: Pool): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT has_function_privilege('probe_nopriv', '${FN}', 'EXECUTE') AS ok`,
  );
  return rows[0].ok === true;
}

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`revoke execute from PUBLIC (pg${pgVersion})`, () => {
    test(
      "control: REVOKE EXECUTE ... FROM <named role> is emitted",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE ROLE app_user;
            CREATE FUNCTION ${FN} RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
            GRANT EXECUTE ON FUNCTION ${FN} TO app_user;
          `,
          testSql: dedent`REVOKE EXECUTE ON FUNCTION ${FN} FROM app_user;`,
          expectedSqlTerms: [
            "SET check_function_bodies = false",
            "REVOKE ALL ON FUNCTION public.secret_fn() FROM app_user",
          ],
        });
      }),
    );

    test(
      "create: preserves REVOKE EXECUTE ... FROM PUBLIC",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: dedent`
            CREATE FUNCTION ${FN} RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
            REVOKE EXECUTE ON FUNCTION ${FN} FROM PUBLIC;
          `,
          expectedSqlTerms: [
            "SET check_function_bodies = false",
            "CREATE FUNCTION public.secret_fn()\n RETURNS integer\n LANGUAGE sql\nAS $function$ SELECT 1 $function$",
            "REVOKE ALL ON FUNCTION public.secret_fn() FROM PUBLIC",
          ],
        });
      }),
    );

    test(
      "applied migration matches the target PUBLIC EXECUTE privilege",
      withDbIsolated(pgVersion, async (db) => {
        const { main, branch } = db;
        await main.query("CREATE ROLE probe_nopriv NOLOGIN");
        await branch.query("CREATE ROLE probe_nopriv NOLOGIN");
        await branch.query(dedent`
          CREATE FUNCTION ${FN} RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
          REVOKE EXECUTE ON FUNCTION ${FN} FROM PUBLIC;
        `);

        const sql = await generatedSql(main, branch);
        for (const stmt of sql) await main.query(stmt);

        expect(await publicCanExecute(branch)).toBe(false);
        expect(await publicCanExecute(main)).toBe(false);
      }),
    );

    test(
      "alter: emits REVOKE EXECUTE ... FROM PUBLIC for an existing function",
      withDbIsolated(pgVersion, async (db) => {
        const { main, branch } = db;
        const setup = dedent`CREATE FUNCTION ${FN} RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`;
        await main.query(setup);
        await branch.query(setup);
        await branch.query(
          dedent`REVOKE EXECUTE ON FUNCTION ${FN} FROM PUBLIC;`,
        );

        const sql = await generatedSql(main, branch);
        expect(sql.join("\n")).toContain("FROM PUBLIC");
      }),
    );
  });
}
