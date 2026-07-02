/**
 * Guards the committed Supabase baseline fixture. The heavy replayability proof
 * is the sync script's zero-diff gate (maintainer-run) and Phase 2b's
 * `applySupabaseBaseInit`-based integration tests; this fast content check pins
 * that the fixture is committed and that the three convergence fixes surfaced by
 * the full-stack baseline are reflected in it, so a regression is caught in CI
 * without booting the Supabase stack.
 */
import { describe, expect, test } from "bun:test";
import { getSupabaseBaseInitSql } from "./supabase-base-init.ts";
import { SUPABASE_BARE_MAJOR } from "./containers.ts";

describe(`supabase base-init fixture (pg${SUPABASE_BARE_MAJOR})`, () => {
  test("is committed, non-empty, and carries the preamble + generated header", async () => {
    const sql = await getSupabaseBaseInitSql();
    expect(sql.length).toBeGreaterThan(1000);
    expect(sql).toContain("SET check_function_bodies = off;");
    expect(sql).toContain("Supabase baseline");
  });

  test("reflects the engine convergence fixes the full-stack baseline surfaced", async () => {
    const sql = await getSupabaseBaseInitSql();

    // Event triggers backing the extensions.* access functions are rebuilt when
    // those functions are replaced (eventTrigger rebuildable).
    expect(sql).toContain("CREATE EVENT TRIGGER");

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
  });
});
