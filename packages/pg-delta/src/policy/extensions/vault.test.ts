/**
 * Unit tests for the supabase_vault handler (docs/architecture/vault.md).
 * No database — shadowPrecheck.matchesStatement is a regex; capable() is
 * exercised with a fake query.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase } from "../../core/fact.ts";
import { vaultHandler } from "./vault.ts";

describe("vaultHandler", () => {
  test("is filter-only: no intent kinds, capture emits nothing", async () => {
    expect(vaultHandler.extension).toBe("supabase_vault");
    expect(vaultHandler.intentKinds).toBeUndefined();
    const result = await vaultHandler.capture(
      { query: async () => [] },
      buildFactBase([], []),
    );
    expect(result.facts).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  test("shadowPrecheck matches vault function calls and CREATE EXTENSION", () => {
    const precheck = vaultHandler.shadowPrecheck!;
    expect(
      precheck.matchesStatement("select vault.create_secret('x','y')"),
    ).toBe(true);
    expect(
      precheck.matchesStatement("SELECT vault.update_secret('id','v')"),
    ).toBe(true);
    expect(precheck.matchesStatement("CREATE EXTENSION supabase_vault")).toBe(
      true,
    );
    expect(
      precheck.matchesStatement(
        'create extension if not exists "supabase_vault"',
      ),
    ).toBe(true);
    expect(precheck.matchesStatement("CREATE EXTENSION hstore")).toBe(false);
    expect(precheck.matchesStatement("select 1")).toBe(false);
    // literals are masked by the caller; a string containing the name is not
    // our problem here, but an unrelated schema.fn must not match
    expect(precheck.matchesStatement("select app.create_secret('x')")).toBe(
      false,
    );
  });

  test("capable() is false when pg_available_extensions lacks supabase_vault", async () => {
    const verdict = await vaultHandler.shadowPrecheck!.capable(async () => [
      { avail: false },
    ]);
    expect(verdict.capable).toBe(false);
    if (!verdict.capable) {
      expect(verdict.reason).toMatch(/does not ship supabase_vault/);
      expect(verdict.reason).toMatch(/Supabase image/);
    }
  });

  test("capable() is true when supabase_vault is available", async () => {
    const verdict = await vaultHandler.shadowPrecheck!.capable(async () => [
      { avail: true },
    ]);
    expect(verdict).toEqual({ capable: true });
  });
});
