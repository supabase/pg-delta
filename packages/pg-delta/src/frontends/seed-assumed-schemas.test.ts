/**
 * deriveAssumedSchemaSeed unit pins (no Docker). Guards the Phase 2b seed
 * derivation and the two silent-failure modes the design review (Fable) flagged:
 *   - the seed plan must NOT re-project (no policy / no referenceOnly), or the
 *     diff would skip every seed fact → a silently EMPTY seed;
 *   - extension members must be excluded (they can't be CREATEd standalone).
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { flattenPolicy } from "../policy/policy.ts";
import { supabasePolicy } from "../policy/supabase.ts";
import { deriveAssumedSchemaSeed } from "./seed-assumed-schemas.ts";

const f = (id: StableId, payload: Fact["payload"] = {}): Fact => ({
  id,
  payload,
});

const supabaseAssumedSchemas =
  flattenPolicy(supabasePolicy).assumedSchemas ?? [];

const schemaAuth: StableId = { kind: "schema", name: "auth" };
const schemaPublic: StableId = { kind: "schema", name: "public" };
const schemaApp: StableId = { kind: "schema", name: "app" };

describe("deriveAssumedSchemaSeed", () => {
  test("seeds an assumed schema and NOT a user schema (non-empty; Q6b/Q6f pin)", () => {
    // auth is an assumed (system) schema → reference-only → seeded.
    // app / public are user-managed → NOT seeded. If a regression forwarded the
    // policy (or referenceOnly) INTO the seed plan, resolveView would re-mark
    // `auth` reference-only, the diff would skip it, and this would go EMPTY —
    // which is exactly the silent failure this assertion catches. It ALSO fails
    // if a future committed supabase baseline subtracts `auth`, forcing whoever
    // lands it to revisit Phase 2b (see supabase.ts baseline TODO).
    const target = buildFactBase(
      [f(schemaPublic), f(schemaApp), f(schemaAuth)],
      [],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: supabasePolicy,
      assumedSchemas: supabaseAssumedSchemas,
      assumedRoles: [],
    });
    expect(seed.sql).toContain('CREATE SCHEMA "auth"');
    expect(seed.sql).not.toContain('"app"');
    expect(seed.schemas).toEqual(["auth"]);
    expect(seed.facts).toBe(1);
  });

  test("excludes extension members (can't be CREATEd standalone)", () => {
    const ext: StableId = { kind: "extension", name: "someext" };
    const memberFn: StableId = {
      kind: "function",
      schema: "auth",
      name: "member_fn",
      args: [],
    };
    const target = buildFactBase(
      [
        f(schemaAuth),
        f(ext),
        f(memberFn, {
          def: `CREATE FUNCTION "auth"."member_fn"() RETURNS void LANGUAGE sql AS $$ $$`,
        }),
      ],
      [{ from: memberFn, to: ext, kind: "memberOfExtension" }],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: supabasePolicy,
      assumedSchemas: supabaseAssumedSchemas,
      assumedRoles: [],
    });
    // the assumed schema is seeded; the extension member is not.
    expect(seed.sql).toContain('CREATE SCHEMA "auth"');
    expect(seed.sql).not.toContain("member_fn");
    expect(seed.facts).toBe(1);
  });

  test("a diff-time baseline containing the assumed schema does NOT empty the seed", () => {
    // The seed answers the SUPERSET question — "what platform objects must
    // exist for user SQL to elaborate in the shadow" — so it must derive from
    // the RAW target, BEFORE the diff-time baseline subtraction. A baseline that
    // contains `auth` (as a real platform baseline would) must NOT remove auth
    // from the seed, or a co-located apply of a user dir referencing auth.users
    // could not load. (Codex #323 finding 3: the seed used to forward the
    // baseline into resolveView, silently emptying the seed.)
    const target = buildFactBase([f(schemaPublic), f(schemaAuth)], []);
    const baseline = buildFactBase([f(schemaAuth)], []);
    const seed = deriveAssumedSchemaSeed(target, {
      policy: supabasePolicy,
      assumedSchemas: supabaseAssumedSchemas,
      assumedRoles: [],
      baseline,
    });
    expect(seed.sql).toContain('CREATE SCHEMA "auth"');
    expect(seed.facts).toBe(1);
  });

  test("raw profile (no assumed schemas) seeds nothing", () => {
    const target = buildFactBase([f(schemaPublic), f(schemaApp)], []);
    const seed = deriveAssumedSchemaSeed(target, {
      assumedSchemas: [],
      assumedRoles: [],
    });
    expect(seed).toEqual({ sql: "", facts: 0, schemas: [] });
  });

  test("no policy → nothing is reference-only → seeds nothing", () => {
    // assumedSchemas is non-empty but without a policy resolveView is the
    // identity projection, so no fact is reference-only and the seed is empty.
    const target = buildFactBase([f(schemaPublic), f(schemaAuth)], []);
    const seed = deriveAssumedSchemaSeed(target, {
      assumedSchemas: ["auth"],
      assumedRoles: [],
    });
    expect(seed.sql).toBe("");
    expect(seed.facts).toBe(0);
  });
});
