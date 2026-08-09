/**
 * Regression for supabase/pg-toolbelt#371: a Supabase instance's platform role
 * plumbing — the `supabase_privileged_role` group role, its grant to
 * `postgres`, and the `postgres` role object itself (NOSUPERUSER + platform
 * `search_path` config) — must be invisible to the supabase managed view.
 * None of it is user-declared state, and none of it can be re-applied as the
 * non-superuser `postgres` (supautils: "Only superusers can alter privileged
 * roles"; the grant requires ADMIN OPTION on the privileged role).
 *
 * `postgres` is deliberately NOT in SUPABASE_SYSTEM_ROLES: Rule 6 excludes
 * objects OWNED by listed roles, and `postgres` owns every user object — so
 * only its role OBJECT is excluded, via a dedicated rule. User role objects
 * and user-granted memberships involving `postgres` as a member stay managed.
 * Pure policy level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { flattenPolicy, resolveView } from "./policy.ts";
import { supabasePolicy } from "./supabase.ts";

const role = (name: string, config: string[] = []): Fact => ({
  id: { kind: "role", name },
  payload: {
    superuser: false,
    inherit: true,
    createRole: name === "postgres",
    createDb: name === "postgres",
    login: name === "postgres",
    replication: false,
    bypassRls: false,
    config,
  },
});

const membership = (roleName: string, member: string): Fact => ({
  id: { kind: "membership", role: roleName, member },
  payload: { admin: false },
});

const id = (fact: Fact): StableId => fact.id;

describe("supabase policy — platform role plumbing (#371)", () => {
  const postgres = role("postgres", [
    'search_path="$user", public, extensions',
  ]);
  const privileged = role("supabase_privileged_role");
  const userRole = role("app_admin");
  const platformGrant = membership("supabase_privileged_role", "postgres");
  const userGrant = membership("app_admin", "postgres");

  const fb = buildFactBase(
    [postgres, privileged, userRole, platformGrant, userGrant],
    [],
  );
  const view = resolveView(fb, supabasePolicy);

  test("excludes the supabase_privileged_role role object and its grant to postgres", () => {
    expect(view.get(id(privileged))).toBeUndefined();
    expect(view.get(id(platformGrant))).toBeUndefined();
  });

  test("excludes the postgres role object (attributes + platform config)", () => {
    expect(view.get(id(postgres))).toBeUndefined();
  });

  test("keeps user role objects and user grants where postgres is the member", () => {
    expect(view.get(id(userRole))).toBeDefined();
    expect(view.get(id(userGrant))).toBeDefined();
  });

  test("assumes postgres and supabase_privileged_role so kept references still resolve", () => {
    const assumed = flattenPolicy(supabasePolicy).assumedRoles ?? [];
    expect(assumed).toContain("postgres");
    expect(assumed).toContain("supabase_privileged_role");
  });
});
