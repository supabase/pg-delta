/**
 * Regression for supabase/pg-toolbelt#371: `schema export --profile supabase
 * --scope cluster` must not emit platform role plumbing as declarative desired
 * state. On a Supabase instance the export leaked:
 *
 *   CREATE ROLE "supabase_privileged_role" …;
 *   GRANT "supabase_privileged_role" TO "postgres";
 *   CREATE ROLE "postgres" WITH NOSUPERUSER …;
 *   ALTER ROLE "postgres" SET "search_path" TO …;
 *
 * none of which the non-superuser `postgres` can re-apply (the grant needs
 * ADMIN OPTION; supautils blocks ALTER on privileged roles). User-declared
 * roles and grants must still round-trip — including a grant whose MEMBER is
 * `postgres`, which is legitimate user state.
 *
 * Mirrors the stock local-Supabase role state on the isolated stock cluster
 * (same recipe tests/containers.ts uses for the Supabase cluster) so the test
 * runs on every matrix leg without the heavy image. Isolated cluster (mutates
 * cluster-global roles); Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { buildSchemaExport } from "../src/frontends/schema-export.ts";
import { supabaseProfile } from "../src/integrations/index.ts";
import { isolatedClusterPair } from "./containers.ts";

let cleanup: (() => Promise<void>) | undefined;

afterAll(async () => {
  await cleanup?.();
});

describe("supabase profile — cluster-scope export excludes platform role plumbing (#371)", () => {
  test("roles.sql omits supabase_privileged_role/postgres plumbing but keeps user roles", async () => {
    const [cluster] = await isolatedClusterPair();
    const base = await cluster.listRoles();
    cleanup = async () => {
      await cluster.dropRolesExcept(base);
    };

    // Stock local-Supabase role state (the issue's environment) + user state.
    await cluster.adminPool.query(`
      CREATE ROLE supabase_privileged_role;
      CREATE ROLE postgres LOGIN PASSWORD 'x' NOSUPERUSER CREATEDB CREATEROLE;
      GRANT supabase_privileged_role TO postgres;
      ALTER ROLE postgres SET search_path TO "$user", public, extensions;
      CREATE ROLE i371_app_admin NOLOGIN;
      GRANT i371_app_admin TO postgres;
    `);

    const result = await buildSchemaExport(cluster.adminPool, {
      profile: supabaseProfile,
      scope: "cluster",
    });
    const rolesSql =
      result.files.find((f) => f.name === "cluster/roles.sql")?.sql ?? "";

    // Platform plumbing must be invisible (issue #371's four statements).
    expect(rolesSql).not.toContain("supabase_privileged_role");
    expect(rolesSql).not.toMatch(/CREATE ROLE "postgres"/);
    expect(rolesSql).not.toMatch(/ALTER ROLE "postgres" SET/);

    // Anti-vacuity: user cluster state still round-trips, including a grant
    // whose member is postgres.
    expect(rolesSql).toContain('CREATE ROLE "i371_app_admin"');
    expect(rolesSql).toContain('GRANT "i371_app_admin" TO "postgres"');
  }, 120_000);
});
