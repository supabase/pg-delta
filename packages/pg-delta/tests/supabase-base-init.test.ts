/**
 * Guards the committed Supabase baseline fixture. The heavy replayability proof
 * is the sync script's zero-diff gate (maintainer-run) and Phase 2b's
 * `applySupabaseBaseInit`-based integration tests; this fast content check pins
 * that the fixture is committed and that the three convergence fixes surfaced by
 * the full-stack baseline are reflected in it, so a regression is caught in CI
 * without booting the Supabase stack.
 */
import { describe, expect, test } from "bun:test";
import { SUPABASE_USER_POLICY_SURFACES } from "../src/policy/supabase.ts";
import { SUPABASE_BARE_MAJOR } from "./containers.ts";
import { getSupabaseBaseInitSql } from "./supabase-base-init.ts";

describe(`supabase base-init fixture (pg${SUPABASE_BARE_MAJOR})`, () => {
  test("is committed, non-empty, and carries the preamble + generated header", async () => {
    const sql = await getSupabaseBaseInitSql();
    expect(sql.length).toBeGreaterThan(1000);
    expect(sql).toContain("SET check_function_bodies = off;");
    expect(sql).toContain("Supabase baseline");
  });

  test("reflects the engine convergence fixes the full-stack baseline surfaced", async () => {
    const sql = await getSupabaseBaseInitSql();

    // A function body change now alters IN PLACE (CREATE OR REPLACE — the def→
    // CREATE-OR-REPLACE refactor), so an extension-access function like
    // grant_pg_net_access() is no longer demolished, and its backing event
    // trigger is no longer dropped + rebuilt. The demolition scaffolding
    // (DROP FUNCTION + DROP/CREATE EVENT TRIGGER + owner re-establish) is gone.
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION extensions.grant_pg_net_access",
    );
    expect(sql).not.toContain(
      'DROP FUNCTION "extensions"."grant_pg_net_access"',
    );
    expect(sql).not.toContain("CREATE EVENT TRIGGER");

    // A standalone unique index referenced by a foreign key is no longer dropped
    // from extraction (relations.ts conindid contype gate).
    expect(sql).toContain("tenants_external_id_index");

    // An array-of-composite column depends on its element type (dependencies.ts
    // array -> element resolution). The type edge blocks compaction from folding
    // the column into CREATE TABLE, so the column lands as a separate ADD COLUMN
    // ordered after the type create.
    const typeAt = sql.indexOf('CREATE TYPE "realtime"."user_defined_filter"');
    const filtersAt = sql.indexOf('ADD COLUMN "filters"');
    expect(typeAt).toBeGreaterThanOrEqual(0);
    expect(filtersAt).toBeGreaterThanOrEqual(0);
    expect(typeAt).toBeLessThan(filtersAt);

    // pg_net now ships in the bare image, so the delta no longer emits
    // CREATE EXTENSION / member-function ACL. The member function itself
    // must still never be created or dropped (extension-managed).
    expect(sql).not.toContain('CREATE EXTENSION "pg_net"');
    expect(sql).not.toContain('CREATE FUNCTION "net"."http_get"');
    expect(sql).not.toContain('DROP FUNCTION "net"."http_get"');
  });

  test("creates the user-policy surfaces with no platform CREATE POLICY", async () => {
    const sql = await getSupabaseBaseInitSql();
    for (const { schema, table } of SUPABASE_USER_POLICY_SURFACES) {
      expect(sql).toContain(`CREATE TABLE "${schema}"."${table}"`);
      expect(sql).not.toMatch(
        new RegExp(
          `CREATE POLICY[\\s\\S]{0,400}ON "${schema}"\\."${table}"`,
          "i",
        ),
      );
    }
  });

  test("enables RLS on the 2024-migration auth tables with no platform CREATE POLICY", async () => {
    // The auth carve-out is SCHEMA-WIDE and rests on the Auth-team guarantee
    // that the service never ships policies on its own tables (2026-08-29).
    // Pin the observable half: the base init enables RLS on exactly the
    // tables of auth's 20240612123726_enable_rls_update_grants migration and
    // seeds zero policies anywhere in auth. The auth tables themselves ship
    // in the bare image, so the fixture (a bare→full-stack delta) carries no
    // CREATE TABLE for them — RLS enablement is the marker they exist.
    const sql = await getSupabaseBaseInitSql();
    const rlsEnabledAuthTables = [
      "audit_log_entries",
      "flow_state",
      "identities",
      "instances",
      "mfa_amr_claims",
      "mfa_challenges",
      "mfa_factors",
      "one_time_tokens",
      "refresh_tokens",
      "saml_providers",
      "saml_relay_states",
      "schema_migrations",
      "sessions",
      "sso_domains",
      "sso_providers",
      "users",
    ];
    for (const table of rlsEnabledAuthTables) {
      expect(sql).toContain(
        `ALTER TABLE "auth"."${table}" ENABLE ROW LEVEL SECURITY`,
      );
    }
    expect(sql).not.toMatch(/CREATE POLICY[^;]{0,200}ON "auth"\./i);
  });
});
