/**
 * User RLS policies on an explicit allowlist of managed-schema tables (the
 * storage / realtime surfaces the platform's `supautils.policy_grants` opens
 * to `postgres`) are user intent, not platform state. Policies have no owner —
 * the discriminator is the surface, not expression inspection. An include rule
 * must win before Rule 4 (system schema exclude); otherwise the policy is
 * marked reference-only (assumed schema) and silently dropped from diffs and
 * exports. Comments ON those policies are user intent too: without their own
 * include, Rule 10 (satellites targeting system-schema objects) drops them
 * (REAL-997).
 *
 * The `auth` schema is covered SCHEMA-WIDE rather than per table: the Auth
 * team guarantees the service never ships or manages RLS policies on its own
 * tables (2026-08-29), so every policy there is customer state regardless of
 * whether supautils policy_grants covers the table.
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

const comment = (target: Fact, text: string): Fact => ({
  id: { kind: "comment", target: target.id } as StableId,
  parent: target.id,
  payload: { text },
});

const id = (fact: Fact): StableId => fact.id;

const objectsPolicy = policy(
  "storage",
  "objects",
  "Users can read own objects",
);
const bucketsPolicy = policy("storage", "buckets", "public buckets");
const bucketsAnalyticsPolicy = policy(
  "storage",
  "buckets_analytics",
  "analytics buckets",
);
const s3UploadsPolicy = policy(
  "storage",
  "s3_multipart_uploads",
  "own uploads",
);
const s3PartsPolicy = policy(
  "storage",
  "s3_multipart_uploads_parts",
  "own upload parts",
);
const messagesPolicy = policy("realtime", "messages", "can presence");
const subscriptionPolicy = policy(
  "realtime",
  "subscription",
  "own subscriptions",
);
const authUsersPolicy = policy("auth", "users", "own row only");
// grantable via supautils policy_grants but RLS never enabled — legal, inert,
// still customer state
const authOauthClientsPolicy = policy("auth", "oauth_clients", "own clients");
// NOT in policy_grants (post-2024 table, deliberate) — schema-wide rule still
// round-trips it if a policy ever exists there
const authPasskeysPolicy = policy("auth", "passkeys", "own passkeys");
const migrationsPolicy = policy("storage", "migrations", "no user policies");
const publicPolicy = policy("public", "t", "public is unmanaged");

const objectsPolicyComment = comment(objectsPolicy, "customer note");
const subscriptionPolicyComment = comment(subscriptionPolicy, "customer note");
const authUsersPolicyComment = comment(authUsersPolicy, "customer note");
const migrationsPolicyComment = comment(migrationsPolicy, "platform note");
const objectsTableComment = comment(
  table("storage", "objects"),
  "platform table metadata",
);
const authUsersTableComment = comment(
  table("auth", "users"),
  "platform table metadata",
);

function world(): Fact[] {
  return [
    schema("storage"),
    schema("realtime"),
    schema("auth"),
    schema("public"),
    table("storage", "objects"),
    table("storage", "buckets"),
    table("storage", "buckets_analytics"),
    table("storage", "s3_multipart_uploads"),
    table("storage", "s3_multipart_uploads_parts"),
    table("storage", "migrations"),
    table("realtime", "messages"),
    table("realtime", "subscription"),
    table("auth", "users"),
    table("auth", "oauth_clients"),
    table("auth", "passkeys"),
    table("public", "t"),
    objectsPolicy,
    bucketsPolicy,
    bucketsAnalyticsPolicy,
    s3UploadsPolicy,
    s3PartsPolicy,
    messagesPolicy,
    subscriptionPolicy,
    authUsersPolicy,
    authOauthClientsPolicy,
    authPasskeysPolicy,
    migrationsPolicy,
    publicPolicy,
    objectsPolicyComment,
    subscriptionPolicyComment,
    authUsersPolicyComment,
    migrationsPolicyComment,
    objectsTableComment,
    authUsersTableComment,
  ];
}

describe("supabase policy — user RLS on managed-schema surfaces", () => {
  const view = resolveView(buildFactBase(world(), []), supabasePolicy);

  test("allowlist covers the supautils.policy_grants Storage / Realtime surfaces", () => {
    expect([...SUPABASE_USER_POLICY_SURFACES]).toEqual([
      { schema: "storage", table: "objects" },
      { schema: "storage", table: "buckets" },
      { schema: "storage", table: "buckets_analytics" },
      { schema: "storage", table: "s3_multipart_uploads" },
      { schema: "storage", table: "s3_multipart_uploads_parts" },
      { schema: "realtime", table: "messages" },
      { schema: "realtime", table: "subscription" },
    ]);
  });

  test("keeps allowlist policies managed, not reference-only", () => {
    for (const fact of [
      objectsPolicy,
      bucketsPolicy,
      bucketsAnalyticsPolicy,
      s3UploadsPolicy,
      s3PartsPolicy,
      messagesPolicy,
      subscriptionPolicy,
    ]) {
      expect(view.get(id(fact))).toBeDefined();
      expect(view.referenceOnly.has(encodeId(id(fact)))).toBe(false);
    }
  });

  test("keeps ANY policy on an auth table managed (schema-wide rule)", () => {
    // The Auth team guarantee (2026-08-29): the service never ships or
    // manages RLS policies on its own tables — every policy there is
    // customer state. Schema-wide, not the supautils policy_grants table
    // list: covers the grantable-but-RLS-off case (oauth_clients) and is
    // immune to future grant-list drift (passkeys has no grant today).
    for (const fact of [
      authUsersPolicy,
      authOauthClientsPolicy,
      authPasskeysPolicy,
    ]) {
      expect(view.get(id(fact))).toBeDefined();
      expect(view.referenceOnly.has(encodeId(id(fact)))).toBe(false);
    }
  });

  test("keeps comments ON allowlist policies managed (REAL-997)", () => {
    for (const fact of [
      objectsPolicyComment,
      subscriptionPolicyComment,
      authUsersPolicyComment,
    ]) {
      expect(view.get(id(fact))).toBeDefined();
      expect(view.referenceOnly.has(encodeId(id(fact)))).toBe(false);
    }
  });

  test("still drops comments on policies OFF the allowlist (Rule 10)", () => {
    expect(view.has(id(migrationsPolicyComment))).toBe(false);
  });

  test("still drops comments on the platform tables themselves (Rule 10)", () => {
    // the carve-out is scoped to POLICY targets: table metadata on the
    // allowlisted surfaces stays platform-managed
    expect(view.has(id(objectsTableComment))).toBe(false);
    expect(view.has(id(authUsersTableComment))).toBe(false);
  });

  test("still projects policies off the allowlist as reference-only", () => {
    // assumed-schema + Rule 4: present so dependents resolve, never diffed
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
