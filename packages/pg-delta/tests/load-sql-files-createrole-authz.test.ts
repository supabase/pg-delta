/**
 * Supabase hands users a CREATEROLE non-superuser `postgres`. On PG 16+,
 * CREATE ROLE no longer auto-grants the creator membership, so
 * `CREATE SCHEMA … AUTHORIZATION new_role` fails with
 * "must be able to SET ROLE" unless `createrole_self_grant` is enabled for the
 * load session. Stock-image superuser tests mask this; this file uses a
 * CREATEROLE non-superuser to prove the loader sets the GUC.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { createTestDb } from "./containers.ts";

const PG_MAJOR = Number(
  /postgres:(\d+)/.exec(
    process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine",
  )?.[1] ?? "17",
);

describe.skipIf(PG_MAJOR < 16)(
  "loadSqlFiles — CREATEROLE non-superuser AUTHORIZATION",
  () => {
    test("CREATE ROLE + CREATE SCHEMA AUTHORIZATION converges", async () => {
      const admin = await createTestDb("createrole_authz_admin");
      const roleName = `load_applier_${admin.name}`;
      const schemaRole = `probe_owner_${admin.name}`;
      let applier: pg.Pool | undefined;
      try {
        await admin.pool.query(
          `CREATE ROLE ${roleName} LOGIN PASSWORD 'applier' CREATEROLE NOSUPERUSER INHERIT`,
        );
        await admin.pool.query(
          `GRANT CREATE ON DATABASE ${admin.name} TO ${roleName}`,
        );
        await admin.pool.query(`GRANT ALL ON SCHEMA public TO ${roleName}`);
        await admin.pool.query(`GRANT ${roleName} TO CURRENT_USER`);

        const url = new URL(admin.uri);
        url.username = roleName;
        url.password = "applier";
        applier = new pg.Pool({ connectionString: url.toString(), max: 2 });

        const result = await loadSqlFiles(
          [
            {
              name: "cluster/roles.sql",
              sql: `create role ${schemaRole} nologin;
create schema ${schemaRole} authorization ${schemaRole};`,
            },
          ],
          applier,
          { mode: "isolatedCluster" },
        );
        expect(result.factBase.has({ kind: "role", name: schemaRole })).toBe(
          true,
        );
        expect(result.factBase.has({ kind: "schema", name: schemaRole })).toBe(
          true,
        );
        // createrole_self_grant bootstrap membership must not leak into the
        // desired-state catalog (would plan GRANT … TO applier WITH ADMIN OPTION).
        expect(
          result.factBase.has({
            kind: "membership",
            role: schemaRole,
            member: roleName,
          }),
        ).toBe(false);
      } finally {
        await applier?.end().catch(() => undefined);
        await admin.pool
          .query(
            `DROP SCHEMA IF EXISTS ${schemaRole} CASCADE; DROP ROLE IF EXISTS ${schemaRole}; DROP ROLE IF EXISTS ${roleName};`,
          )
          .catch(() => undefined);
        await admin.drop();
      }
    }, 60_000);
  },
);
