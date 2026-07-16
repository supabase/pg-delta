/**
 * Regression tests for non-superuser catalog extraction (supabase/cli#5826, CLI-1919).
 *
 * When connected as a non-superuser role (e.g. the `postgres` role on Supabase
 * hosted projects), extraction must not SELECT from superuser-only catalogs such
 * as `pg_user_mapping` or the `pg_subscription.subconninfo` column.
 *
 * The `role` option only performs `SET ROLE` on every pooled connection when
 * `createPlan` is given connection URL strings (via `createManagedPool`) — this
 * is exactly the Supabase CLI production path. `withDbIsolated` hands back Pool
 * objects (which bypass `SET ROLE` during extraction), so these tests start
 * containers directly to obtain connection URIs and drive the string path.
 */

import { describe, expect, test } from "bun:test";
import { createPlan } from "../../src/core/plan/create.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";
import { createPool } from "../../src/core/postgres-config.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import {
  buildPostgresTestImage,
  PostgresAlpineContainer,
} from "../postgres-alpine.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`non-superuser extraction (pg${pgVersion})`, () => {
    test("non-superuser role can extract a catalog containing user mappings and subscriptions", async () => {
      const image = await buildPostgresTestImage(pgVersion);
      const [containerMain, containerBranch] = await Promise.all([
        new PostgresAlpineContainer(image).start(),
        new PostgresAlpineContainer(image).start(),
      ]);
      const mainUri = containerMain.getConnectionUri();
      const branchUri = containerBranch.getConnectionUri();

      // Admin pools (default superuser) to set up the fixtures.
      const mainAdmin = createPool(mainUri);
      const branchAdmin = createPool(branchUri);

      try {
        // Isolated containers don't share roles: create on both sides.
        await mainAdmin.query(
          "CREATE ROLE pgdelta_nosuper WITH NOLOGIN NOSUPERUSER;",
        );
        await branchAdmin.query(
          "CREATE ROLE pgdelta_nosuper WITH NOLOGIN NOSUPERUSER;",
        );

        // Branch has the objects the non-superuser reader must be able to see.
        await branchAdmin.query("CREATE FOREIGN DATA WRAPPER test_fdw;");
        await branchAdmin.query(
          "CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;",
        );
        await branchAdmin.query(
          "CREATE USER MAPPING FOR PUBLIC SERVER test_server OPTIONS (user 'remote_user', password 'secret');",
        );
        await branchAdmin.query(
          "CREATE SUBSCRIPTION test_sub CONNECTION 'host=example.invalid dbname=x' PUBLICATION test_pub WITH (connect = false, slot_name = NONE, enabled = false, create_slot = false);",
        );

        const result = await createPlan(mainUri, branchUri, {
          role: "pgdelta_nosuper",
        });

        expect(result).not.toBeNull();
        const statements = flattenPlanStatements(result!.plan);

        // User mapping is created with NO options (unprivileged reader cannot
        // see umoptions, so they degrade to an empty option list).
        const userMappingStatement = statements.find((s) =>
          s.includes("CREATE USER MAPPING FOR PUBLIC SERVER test_server"),
        );
        expect(userMappingStatement).toBeDefined();
        expect(userMappingStatement).not.toContain("OPTIONS");
        expect(userMappingStatement).not.toContain("remote_user");
        expect(userMappingStatement).not.toContain("secret");

        // Subscription is created, but conninfo is the redacted placeholder.
        const subscriptionStatement = statements.find((s) =>
          s.includes("CREATE SUBSCRIPTION"),
        );
        expect(subscriptionStatement).toBeDefined();
        expect(subscriptionStatement).not.toContain("example.invalid");
      } finally {
        await Promise.all([mainAdmin.end(), branchAdmin.end()]);
        await Promise.all([containerMain.stop(), containerBranch.stop()]);
      }
    });

    test("identical FDW state on both sides diffs clean as non-superuser", async () => {
      const image = await buildPostgresTestImage(pgVersion);
      const [containerMain, containerBranch] = await Promise.all([
        new PostgresAlpineContainer(image).start(),
        new PostgresAlpineContainer(image).start(),
      ]);
      const mainUri = containerMain.getConnectionUri();
      const branchUri = containerBranch.getConnectionUri();

      const mainAdmin = createPool(mainUri);
      const branchAdmin = createPool(branchUri);

      try {
        for (const pool of [mainAdmin, branchAdmin]) {
          await pool.query(
            "CREATE ROLE pgdelta_nosuper WITH NOLOGIN NOSUPERUSER;",
          );
          await pool.query("CREATE FOREIGN DATA WRAPPER test_fdw;");
          await pool.query(
            "CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;",
          );
          await pool.query(
            "CREATE USER MAPPING FOR PUBLIC SERVER test_server OPTIONS (user 'remote_user', password 'secret');",
          );
        }

        const result = await createPlan(mainUri, branchUri, {
          role: "pgdelta_nosuper",
        });

        // Options are hidden symmetrically on both sides, so there is no
        // spurious user-mapping/server/fdw diff.
        const relevant = result
          ? flattenPlanStatements(result.plan).filter(
              (s) =>
                s.includes("USER MAPPING") ||
                s.includes("SERVER") ||
                s.includes("FOREIGN DATA WRAPPER"),
            )
          : [];
        expect(relevant).toEqual([]);
      } finally {
        await Promise.all([mainAdmin.end(), branchAdmin.end()]);
        await Promise.all([containerMain.stop(), containerBranch.stop()]);
      }
    });
  });
}
