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
import { flattenPolicy, type Policy } from "../policy/policy.ts";
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
    expect(seed).toEqual({
      sql: "",
      facts: 0,
      schemas: [],
      seededRoutines: new Map(),
    });
  });

  // Unit C: a seeded routine carrying a superuser-only `SET` clause cannot be
  // CREATEd by a non-superuser applier at all (SQLSTATE 42501 at CREATE time),
  // and platform ADP entries fail the same way. The routine's `SET` clause lives
  // inside its semantic `def` payload; the parallel `_configGucs` key is a
  // NON-semantic structured duplicate of the SET GUC NAMES (populated from
  // `pg_proc.proconfig` at extract time, `_`-prefixed ⇒ dropped from hash + diff)
  // that lets the seed DECIDE which routines to skip WITHOUT reading SQL text. A
  // custom profile that assumes `platform` marks its facts reference-only, so
  // they land in the seed.
  const platformPolicy: Policy = {
    id: "test-platform",
    filter: [
      {
        match: { any: [{ schema: "platform" }, { name: "platform" }] },
        action: "exclude",
      },
    ],
    assumedSchemas: ["platform"],
  };
  const schemaPlatform: StableId = { kind: "schema", name: "platform" };
  const noisyFn: StableId = {
    kind: "function",
    schema: "platform",
    name: "noisy",
    args: [],
  };
  const tidyFn: StableId = {
    kind: "function",
    schema: "platform",
    name: "tidy",
    args: [],
  };
  // Mirrors pg_get_functiondef output: SET clauses are header lines before `AS`.
  const noisyDef =
    `CREATE OR REPLACE FUNCTION platform.noisy()\n` +
    ` RETURNS integer\n` +
    ` LANGUAGE sql\n` +
    ` SET search_path TO 'public'\n` +
    ` SET log_min_messages TO 'fatal'\n` +
    `AS $function$SELECT 1$function$`;
  const tidyDef =
    `CREATE OR REPLACE FUNCTION platform.tidy()\n` +
    ` RETURNS integer\n` +
    ` LANGUAGE sql\n` +
    ` SET search_path TO 'public'\n` +
    `AS $function$SELECT 1$function$`;
  const routinePayload = (
    def: string,
    configGucs: string[],
  ): Fact["payload"] => ({
    def,
    returnType: "integer",
    argSignature: "",
    language: "sql",
    isWindow: false,
    // Structured GUC names from proconfig; `_`-prefixed ⇒ non-semantic (excluded
    // from hash + diff), used only for the seed skip decision.
    _configGucs: configGucs,
  });
  const adpFact: Fact = {
    id: {
      kind: "defaultPrivilege",
      role: "admin",
      schema: "platform",
      objtype: "r",
      grantee: "reader",
    },
    payload: { privileges: ["SELECT"], grantable: [] },
  };
  // Snapshot target: a single routine + ADP, so the no-option path can be pinned
  // byte-identical (routine def rendered verbatim, ADP omitted).
  const platformTarget = () =>
    buildFactBase(
      [
        f(schemaPlatform),
        f(
          noisyFn,
          routinePayload(noisyDef, ["search_path", "log_min_messages"]),
        ),
        adpFact,
      ],
      [],
    );

  test("susetGucs excludes the whole offending routine (not a stripped copy); a search_path-only routine is seeded intact; ADP omitted", () => {
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(
          noisyFn,
          routinePayload(noisyDef, ["search_path", "log_min_messages"]),
        ),
        f(tidyFn, routinePayload(tidyDef, ["search_path"])),
        adpFact,
      ],
      [],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: ["admin", "reader"],
      susetGucs: new Set(["log_min_messages"]),
    });
    // the WHOLE offending routine is absent — no trace of a stripped version.
    expect(seed.sql).not.toContain("noisy");
    expect(seed.sql).not.toContain("log_min_messages");
    // a routine whose only proconfig GUC is user-context (search_path) is kept.
    expect(seed.sql).toContain("platform.tidy()");
    expect(seed.sql).toContain("SET search_path TO 'public'");
    // ADP is unconditionally omitted (no member-of-role at replay).
    expect(seed.sql).not.toContain("ALTER DEFAULT PRIVILEGES");
  });

  test("a fact depending on the excluded routine is excluded transitively", () => {
    const dependentFn: StableId = {
      kind: "function",
      schema: "platform",
      name: "dependent",
      args: [],
    };
    const dependentDef =
      `CREATE OR REPLACE FUNCTION platform.dependent()\n` +
      ` RETURNS integer\n` +
      ` LANGUAGE sql\n` +
      `AS $function$SELECT platform.noisy()$function$`;
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(
          noisyFn,
          routinePayload(noisyDef, ["search_path", "log_min_messages"]),
        ),
        f(dependentFn, routinePayload(dependentDef, [])),
      ],
      [{ from: dependentFn, to: noisyFn, kind: "depends" }],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: [],
      susetGucs: new Set(["log_min_messages"]),
    });
    // the excluded routine AND its dependent are both gone; the schema remains.
    expect(seed.sql).not.toContain("noisy");
    expect(seed.sql).not.toContain("dependent");
    expect(seed.sql).toContain('CREATE SCHEMA "platform"');
  });

  test("a container fact excluded via depends does not orphan its CHILD facts (structural cascade)", () => {
    // A view depends (via `depends` edge) on the SUSET-GUC routine, so the
    // depends-edge fixpoint excludes the view. Parent/child containment is NOT
    // a `depends` edge (it's structural, via Fact.parent — see fact.ts), so
    // without a structural cascade the view's column child survives the flat
    // `keptFacts.filter` and buildFactBase throws "references missing parent"
    // because its parent (the view) was excluded.
    const reportsView: StableId = {
      kind: "view",
      schema: "platform",
      name: "reports",
    };
    const reportsIdColumn: StableId = {
      kind: "column",
      schema: "platform",
      table: "reports",
      name: "id",
    };
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(
          noisyFn,
          routinePayload(noisyDef, ["search_path", "log_min_messages"]),
        ),
        { id: reportsView, parent: schemaPlatform, payload: {} },
        { id: reportsIdColumn, parent: reportsView, payload: {} },
      ],
      [{ from: reportsView, to: noisyFn, kind: "depends" }],
    );
    // Before the fix this call throws:
    //   FactBase: fact column|platform|reports|id references missing parent view|platform|reports
    const seed = deriveAssumedSchemaSeed(target, {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: [],
      susetGucs: new Set(["log_min_messages"]),
    });
    // the excluded routine AND the dependent view AND its column child are all
    // gone; the schema remains.
    expect(seed.sql).not.toContain("noisy");
    expect(seed.sql).not.toContain("reports");
    expect(seed.sql).toContain('CREATE SCHEMA "platform"');
  });

  test("without susetGucs: routine def retained verbatim (byte-identical), ADP still omitted", () => {
    const seed = deriveAssumedSchemaSeed(platformTarget(), {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: ["admin", "reader"],
    });
    expect(seed.sql).toMatchInlineSnapshot(`
      "SET check_function_bodies = off;

      CREATE SCHEMA "platform";

      CREATE OR REPLACE FUNCTION platform.noisy()
       RETURNS integer
       LANGUAGE sql
       SET search_path TO 'public'
       SET log_min_messages TO 'fatal'
      AS $function$SELECT 1$function$;
      "
    `);
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
