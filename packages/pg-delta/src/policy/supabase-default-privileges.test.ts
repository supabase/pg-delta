/**
 * A real Supabase user connects as `postgres` (a non-superuser) and can NEVER
 * execute `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin …` — that requires
 * membership in `supabase_admin`, which is reserved. Those default-privilege
 * entries are platform-managed, the same provenance judgment Rule 6 already
 * makes for objects OWNED by a system role — but `defaultPrivilege` facts
 * carry no owner edge/payload, so Rule 6 never matches them; the FOR-role
 * lives in the fact id (`id.role`) instead. Pure policy level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { resolveView } from "./policy.ts";
import { supabasePolicy } from "./supabase.ts";

const schema = (name: string): Fact => ({
  id: { kind: "schema", name },
  payload: {},
});

const defaultPrivilege = (role: string, grantee: string): Fact => ({
  id: { kind: "defaultPrivilege", role, schema: "public", objtype: "r", grantee },
  payload: { privileges: ["SELECT"], grantable: [] },
});

const forSupabaseAdminToAnon: StableId = {
  kind: "defaultPrivilege",
  role: "supabase_admin",
  schema: "public",
  objtype: "r",
  grantee: "anon",
};
const forPostgresToAnon: StableId = {
  kind: "defaultPrivilege",
  role: "postgres",
  schema: "public",
  objtype: "r",
  grantee: "anon",
};
const forPostgresToAuthenticated: StableId = {
  kind: "defaultPrivilege",
  role: "postgres",
  schema: "public",
  objtype: "r",
  grantee: "authenticated",
};

describe("supabase policy — default privileges declared FOR a system role", () => {
  test("excludes ADP declared FOR ROLE supabase_admin; keeps user-owned FOR ROLE postgres ADP", () => {
    const fb = buildFactBase(
      [
        schema("public"),
        defaultPrivilege("supabase_admin", "anon"),
        defaultPrivilege("postgres", "anon"),
        defaultPrivilege("postgres", "authenticated"),
      ],
      [],
    );
    const view = resolveView(fb, supabasePolicy);
    // platform-managed (FOR ROLE supabase_admin) → a non-superuser postgres can
    // never execute this ADP → must be invisible to the managed view.
    expect(view.get(forSupabaseAdminToAnon)).toBeUndefined();
    // user-owned API-role defaults (FOR ROLE postgres) survive regardless of
    // which system role is the GRANTEE.
    expect(view.get(forPostgresToAnon)).toBeDefined();
    expect(view.get(forPostgresToAuthenticated)).toBeDefined();
  });
});
