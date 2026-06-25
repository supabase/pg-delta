import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import type { Pool } from "pg";
import { createPlan } from "../../src/core/plan/create.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { roundtripFidelityTest } from "../integration/roundtrip.ts";
import { withDbIsolated } from "../utils.ts";

const FUNCTION_SIGNATURE = "public.secret_fn()";
const CHECK_FUNCTION_BODIES = "SET check_function_bodies = false";

function createFunctionSql(name: string): string {
  return [
    `CREATE FUNCTION public.${name}()`,
    " RETURNS integer",
    " LANGUAGE sql",
    "AS $function$ SELECT 1 $function$",
  ].join("\n");
}

async function generatedSql(
  main: Pool,
  branch: Pool,
  options: Parameters<typeof createPlan>[2] = {},
): Promise<string[]> {
  const planResult = await createPlan(main, branch, options);
  return planResult ? flattenPlanStatements(planResult.plan) : [];
}

async function publicCanExecute(db: Pool): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT has_function_privilege('probe_nopriv', '${FUNCTION_SIGNATURE}', 'EXECUTE') AS ok`,
  );
  return rows[0].ok === true;
}

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`revoke execute from PUBLIC (pg${pgVersion})`, () => {
    test(
      "create preserves REVOKE EXECUTE FROM PUBLIC and applies the locked-down behavior",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE ROLE probe_nopriv NOLOGIN",
          testSql: dedent`
            CREATE FUNCTION ${FUNCTION_SIGNATURE}
            RETURNS int
            LANGUAGE sql
            AS $$ SELECT 1 $$;

            REVOKE EXECUTE ON FUNCTION ${FUNCTION_SIGNATURE} FROM PUBLIC;
          `,
          assertSqlStatements: (statements) => {
            expect(statements).toEqual([
              CHECK_FUNCTION_BODIES,
              createFunctionSql("secret_fn"),
              "REVOKE ALL ON FUNCTION public.secret_fn() FROM PUBLIC",
            ]);
          },
        });

        expect(await publicCanExecute(db.branch)).toBe(false);
        expect(await publicCanExecute(db.main)).toBe(false);
      }),
    );

    test(
      "alter emits REVOKE EXECUTE FROM PUBLIC for an existing function",
      withDbIsolated(pgVersion, async (db) => {
        const setup = dedent`
          CREATE FUNCTION ${FUNCTION_SIGNATURE}
          RETURNS int
          LANGUAGE sql
          AS $$ SELECT 1 $$;
        `;
        await db.main.query(setup);
        await db.branch.query(setup);
        await db.branch.query(
          `REVOKE EXECUTE ON FUNCTION ${FUNCTION_SIGNATURE} FROM PUBLIC`,
        );

        const sql = await generatedSql(db.main, db.branch);

        expect(sql).toEqual([
          CHECK_FUNCTION_BODIES,
          "REVOKE ALL ON FUNCTION public.secret_fn() FROM PUBLIC",
        ]);
      }),
    );

    test(
      "planned global default revoke prevents redundant per-function revoke on create",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: dedent`
            ALTER DEFAULT PRIVILEGES
              REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

            CREATE FUNCTION ${FUNCTION_SIGNATURE}
            RETURNS int
            LANGUAGE sql
            AS $$ SELECT 1 $$;
          `,
          assertSqlStatements: (statements) => {
            expect(statements).toEqual([
              CHECK_FUNCTION_BODIES,
              "ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON ROUTINES FROM PUBLIC",
              createFunctionSql("secret_fn"),
            ]);
            expect(
              statements.filter((statement) =>
                statement.startsWith("REVOKE ALL ON FUNCTION"),
              ),
            ).toEqual([]);
          },
        });
      }),
    );

    test(
      "self-contained plan emits only the explicit PUBLIC revoke needed for locked-down functions",
      withDbIsolated(pgVersion, async (db) => {
        await db.branch.query(dedent`
          CREATE FUNCTION public.open_fn()
          RETURNS int
          LANGUAGE sql
          AS $$ SELECT 1 $$;

          CREATE FUNCTION public.secret_fn()
          RETURNS int
          LANGUAGE sql
          AS $$ SELECT 1 $$;

          REVOKE EXECUTE ON FUNCTION public.secret_fn() FROM PUBLIC;
        `);

        const sql = await generatedSql(db.main, db.branch, {
          skipDefaultPrivilegeSubtraction: true,
        });

        expect(sql).toEqual([
          CHECK_FUNCTION_BODIES,
          createFunctionSql("open_fn"),
          createFunctionSql("secret_fn"),
          "REVOKE ALL ON FUNCTION public.secret_fn() FROM PUBLIC",
        ]);
        expect(sql.join("\n")).not.toContain(
          "GRANT ALL ON FUNCTION public.open_fn() TO PUBLIC",
        );
      }),
    );
  });
}
