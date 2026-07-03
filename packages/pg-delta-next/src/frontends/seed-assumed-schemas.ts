/**
 * Phase 2b (#41): derive the SQL that seeds a co-located shadow database with a
 * target's ASSUMED-SCHEMA objects (e.g. `auth.users` under `--profile
 * supabase`), so a user declarative dir that references those platform objects
 * can load into the otherwise-empty shadow.
 *
 * The managed view (`resolveView`) marks two disjoint categories reference-only
 * in ONE set: assumed-schema objects (`auth.users`) and extension members
 * (`net.http_get`). We seed only the former:
 *   - extension members can't be `CREATE`d standalone — `CREATE EXTENSION` owns
 *     their lifecycle — and they don't NEED seeding: they are reference-only on
 *     the target (diff) side, and `diff.ts` skips a fact reference-only on EITHER
 *     side, so a shadow that lacks them plans no spurious DROP. A user file that
 *     references a member is served by the user's own `CREATE EXTENSION`.
 *   - assumed-schema EXTENSIONS themselves (a system extension whose install
 *     schema is assumed, e.g. `pg_graphql` in `graphql`) are NOT members, so
 *     they land in the seed as `CREATE EXTENSION` and materialize their members
 *     for free — the same-cluster shadow has the shared libraries.
 *
 * Symmetry: after seed + user load, the shadow is re-extracted through the SAME
 * profile, so the seeded objects come back reference-only and cancel against the
 * target's reference-only copies in `plan()` — nothing leaks into the diff.
 */
import { buildFactBase, type FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { plan } from "../plan/plan.ts";
import { renderPlanSql } from "../plan/render-sql.ts";
import type { ApplierCapability } from "../policy/capability.ts";
import { type Policy, resolveView } from "../policy/policy.ts";
import { extensionMemberReferenceOnly } from "../policy/view.ts";

export interface AssumedSchemaSeed {
  /** Replayable SQL that creates the assumed-schema objects; `""` when nothing
   *  needs seeding (raw profile, or the view kept no assumed-schema facts). */
  sql: string;
  /** Number of facts materialized by the seed (for progress logging + tests). */
  facts: number;
  /** Distinct assumed-schema names actually seeded. Passed to `loadSqlFiles` so
   *  its shadow-emptiness guard ignores exactly what we pre-populated. */
  schemas: string[];
}

const EMPTY: AssumedSchemaSeed = { sql: "", facts: 0, schemas: [] };

/** Assumed-schema name a fact belongs to: a schema fact IS its own schema; any
 *  schema-qualified fact carries `schema`. (Satellites — `target`-shaped ids —
 *  are hard-pruned by `resolveView`, so they never reach the seed set.) */
function assumedSchemaOf(id: StableId): string | undefined {
  if (id.kind === "schema") return (id as { name: string }).name;
  return (id as { schema?: string }).schema;
}

export function deriveAssumedSchemaSeed(
  targetFb: FactBase,
  opts: {
    policy?: Policy;
    capability?: ApplierCapability;
    baseline?: FactBase;
    assumedSchemas: string[];
    /** Policy assumed roles PLUS the target's own role names — same cluster, so
     *  every owner/grant role reference in the seed is present at replay. */
    assumedRoles: string[];
  },
): AssumedSchemaSeed {
  // raw profile (no assumed schemas): nothing is platform-external, no seed.
  if (opts.assumedSchemas.length === 0) return EMPTY;

  const view = resolveView(
    targetFb,
    opts.policy,
    opts.capability,
    opts.baseline,
  );
  const members = extensionMemberReferenceOnly(targetFb);
  const seedIds = new Set(
    [...view.referenceOnly].filter((id) => !members.has(id)),
  );
  if (seedIds.size === 0) return EMPTY;

  const seedFacts = view.facts().filter((f) => seedIds.has(encodeId(f.id)));
  const seedEdges = [...view.edges].filter(
    (e) => seedIds.has(encodeId(e.from)) && seedIds.has(encodeId(e.to)),
  );

  // CRITICAL (Fable review Q6b): the seed plan must NOT re-project.
  //   - `buildFactBase(...)` is called WITHOUT the 4th `referenceOnly` arg, and
  //   - `plan(...)` is called WITHOUT a `policy`,
  // because either would re-mark every seed fact reference-only and the diff
  // would skip all of them — a SILENT empty seed. We want a from-empty CREATE
  // for each assumed object. `assumedSchemas`/`assumedRoles` are forwarded only
  // so the requirement guard exempts references to objects OUTSIDE the seed set
  // (an extension member, a platform role) exactly as the export path does.
  const assumedOnlyFb = buildFactBase(seedFacts, seedEdges, view.source);
  const seedPlan = plan(buildFactBase([], []), assumedOnlyFb, {
    renames: "off",
    assumedSchemas: opts.assumedSchemas,
    assumedRoles: opts.assumedRoles,
  });
  if (seedPlan.actions.length === 0) return EMPTY;

  const schemas = [
    ...new Set(
      seedFacts
        .map((f) => assumedSchemaOf(f.id))
        .filter((s): s is string => s !== undefined),
    ),
  ];
  return { sql: renderPlanSql(seedPlan), facts: seedFacts.length, schemas };
}
