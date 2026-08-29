/**
 * User GRANTs on managed-schema objects (CLI-1385 Phase 5, Unit B). The
 * platform can only grant to roles it knows (service roles, the API roles,
 * `postgres`, PUBLIC), so an ACL entry on a managed-schema object whose
 * grantee is a CUSTOMER-created role is customer intent by construction —
 * the fixture pin and the pristine guard hold the observable half (the base
 * image seeds no such entries).
 *
 * The discriminator is the GRANTEE, not the grantor: extraction deliberately
 * merges privileges across grantors (effective-set model, see aclJson), and
 * the grantor differs between the live side (postgres) and the shadow side
 * (the loader role) for identical intent, so a grantor-keyed rule could never
 * classify both sides of a diff symmetrically.
 *
 * Pure policy level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { resolveView } from "./policy.ts";
import { SUPABASE_PLATFORM_GRANTEES, supabasePolicy } from "./supabase.ts";

const schema = (name: string): Fact => ({
  id: { kind: "schema", name },
  payload: {},
});

const table = (schemaName: string, name: string): Fact => ({
  id: { kind: "table", schema: schemaName, name },
  parent: { kind: "schema", name: schemaName },
  payload: { persistence: "p" },
});

const acl = (target: Fact, grantee: string, column?: string): Fact => ({
  id: {
    kind: "acl",
    target: target.id,
    grantee,
    ...(column === undefined ? {} : { column }),
  } as StableId,
  parent: target.id,
  payload: { privileges: ["SELECT"], grantable: [] },
});

const id = (fact: Fact): StableId => fact.id;

const authUsers = table("auth", "users");
const storageObjects = table("storage", "objects");
const publicTable = table("public", "t");
const authSchema = schema("auth");
const fdw: Fact = { id: { kind: "fdw", name: "my_fdw" }, payload: {} };

const customOnAuthUsers = acl(authUsers, "app_reader");
const customColumnOnAuthUsers = acl(authUsers, "app_reader", "email");
const customOnStorageObjects = acl(storageObjects, "app_reader");
const customOnAuthSchema = acl(authSchema, "app_reader");
const customOnPublicTable = acl(publicTable, "app_reader");
const customOnFdw = acl(fdw, "app_reader");
const authenticatedOnStorageObjects = acl(storageObjects, "authenticated");
const postgresOnAuthUsers = acl(authUsers, "postgres");
const publicOnAuthUsers = acl(authUsers, "PUBLIC");
const pgMonitorOnAuthUsers = acl(authUsers, "pg_monitor");

function world(): Fact[] {
  return [
    authSchema,
    schema("storage"),
    schema("public"),
    authUsers,
    storageObjects,
    publicTable,
    fdw,
    customOnAuthUsers,
    customColumnOnAuthUsers,
    customOnStorageObjects,
    customOnAuthSchema,
    customOnPublicTable,
    customOnFdw,
    authenticatedOnStorageObjects,
    postgresOnAuthUsers,
    publicOnAuthUsers,
    pgMonitorOnAuthUsers,
  ];
}

describe("supabase policy — user GRANTs on managed-schema objects", () => {
  const view = resolveView(buildFactBase(world(), []), supabasePolicy);

  test("platform grantees are the system roles plus postgres, PUBLIC, pg_*", () => {
    expect(SUPABASE_PLATFORM_GRANTEES).toContain("postgres");
    expect(SUPABASE_PLATFORM_GRANTEES).toContain("PUBLIC");
    expect(SUPABASE_PLATFORM_GRANTEES).toContain("pg_*");
    expect(SUPABASE_PLATFORM_GRANTEES).toContain("authenticated");
    expect(SUPABASE_PLATFORM_GRANTEES).toContain("supabase_auth_admin");
  });

  test("keeps grants TO customer roles on managed-schema objects managed", () => {
    for (const fact of [
      customOnAuthUsers,
      customColumnOnAuthUsers,
      customOnStorageObjects,
    ]) {
      expect(view.get(id(fact))).toBeDefined();
      expect(view.referenceOnly.has(encodeId(id(fact)))).toBe(false);
    }
  });

  test("keeps a customer USAGE grant on the managed schema itself managed", () => {
    expect(view.get(id(customOnAuthSchema))).toBeDefined();
    expect(view.referenceOnly.has(encodeId(id(customOnAuthSchema)))).toBe(
      false,
    );
  });

  test("still drops grants TO platform grantees on managed objects (Rule 10)", () => {
    // These collide with platform-seeded entries at the (target, grantee)
    // grain (auth grants TO postgres, storage grants TO the API roles), so
    // they stay platform-managed until a baseline can subtract the seed.
    for (const fact of [
      authenticatedOnStorageObjects,
      postgresOnAuthUsers,
      publicOnAuthUsers,
      pgMonitorOnAuthUsers,
    ]) {
      expect(view.has(id(fact))).toBe(false);
    }
  });

  test("keeps an ordinary public-schema grant managed", () => {
    expect(view.get(id(customOnPublicTable))).toBeDefined();
    expect(view.referenceOnly.has(encodeId(id(customOnPublicTable)))).toBe(
      false,
    );
  });

  test("FDW grants stay excluded even for customer grantees (Rule 9)", () => {
    // GRANT ON FOREIGN DATA WRAPPER requires superuser regardless of grantee;
    // the user-grant include matches only schema-carrying targets, so the
    // unconditional FDW exclusion still wins.
    expect(view.has(id(customOnFdw))).toBe(false);
  });
});
