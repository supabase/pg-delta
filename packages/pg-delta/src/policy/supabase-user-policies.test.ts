/**
 * User RLS policies on an explicit allowlist of managed-schema tables
 * (storage.objects / storage.buckets / realtime.messages) are user intent, not
 * platform state. Policies have no owner — the discriminator is the surface,
 * not expression inspection. An include rule must win before Rule 4 (system
 * schema exclude); otherwise the policy is marked reference-only (assumed
 * schema) and silently dropped from diffs and exports.
 *
 * Pure policy level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { resolveView } from "./policy.ts";
import { SUPABASE_USER_POLICY_SURFACES, supabasePolicy } from "./supabase.ts";

const schema = (name: string): Fact => ({
  id: { kind: "schema", name },
  payload: {},
});

const table = (schemaName: string, name: string): Fact => ({
  id: { kind: "table", schema: schemaName, name },
  parent: { kind: "schema", name: schemaName },
  payload: { persistence: "p" },
});

const policy = (schemaName: string, tableName: string, name: string): Fact => ({
  id: { kind: "policy", schema: schemaName, table: tableName, name },
  parent: { kind: "table", schema: schemaName, name: tableName },
  payload: {
    cmd: "r",
    permissive: true,
    usingExpr: "true",
    checkExpr: null,
    roles: ["authenticated"],
  },
});

const id = (fact: Fact): StableId => fact.id;

const objectsPolicy = policy(
  "storage",
  "objects",
  "Users can read own objects",
);
const bucketsPolicy = policy("storage", "buckets", "public buckets");
const messagesPolicy = policy("realtime", "messages", "can presence");
const authUsersPolicy = policy("auth", "users", "users cannot do this");
const migrationsPolicy = policy("storage", "migrations", "no user policies");
const publicPolicy = policy("public", "t", "public is unmanaged");

function world(): Fact[] {
  return [
    schema("storage"),
    schema("realtime"),
    schema("auth"),
    schema("public"),
    table("storage", "objects"),
    table("storage", "buckets"),
    table("storage", "migrations"),
    table("realtime", "messages"),
    table("auth", "users"),
    table("public", "t"),
    objectsPolicy,
    bucketsPolicy,
    messagesPolicy,
    authUsersPolicy,
    migrationsPolicy,
    publicPolicy,
  ];
}

describe("supabase policy — user RLS on managed-schema surfaces", () => {
  const view = resolveView(buildFactBase(world(), []), supabasePolicy);

  test("allowlist covers the documented Storage / Realtime policy surfaces", () => {
    expect([...SUPABASE_USER_POLICY_SURFACES]).toEqual([
      { schema: "storage", table: "objects" },
      { schema: "storage", table: "buckets" },
      { schema: "realtime", table: "messages" },
    ]);
  });

  test("keeps allowlist policies managed, not reference-only", () => {
    for (const fact of [objectsPolicy, bucketsPolicy, messagesPolicy]) {
      expect(view.get(id(fact))).toBeDefined();
      expect(view.referenceOnly.has(encodeId(id(fact)))).toBe(false);
    }
  });

  test("still projects policies off the allowlist as reference-only", () => {
    // assumed-schema + Rule 4: present so dependents resolve, never diffed
    expect(view.get(id(authUsersPolicy))).toBeDefined();
    expect(view.referenceOnly.has(encodeId(id(authUsersPolicy)))).toBe(true);
    expect(view.get(id(migrationsPolicy))).toBeDefined();
    expect(view.referenceOnly.has(encodeId(id(migrationsPolicy)))).toBe(true);
  });

  test("keeps an ordinary public-schema policy managed", () => {
    expect(view.get(id(publicPolicy))).toBeDefined();
    expect(view.referenceOnly.has(encodeId(id(publicPolicy)))).toBe(false);
  });

  test("platform tables stay reference-only so export cannot recreate them", () => {
    const objects = table("storage", "objects");
    expect(view.get(id(objects))).toBeDefined();
    expect(view.referenceOnly.has(encodeId(id(objects)))).toBe(true);
  });
});
