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
 *
 * Baseline is deliberately NOT applied here (Codex #323 finding 3). The seed is
 * the SUPERSET question — "what platform objects must exist for the user SQL to
 * elaborate in the shadow" — whereas the diff is the SUBSET question — "what do
 * we manage". Only the diff subtracts the baseline. A baseline routinely
 * CONTAINS the assumed-schema objects (e.g. `auth.users`), so subtracting it
 * before the reference-only marking would silently empty the seed and a
 * co-located apply of a user dir referencing those objects could not load. The
 * profile's baseline is still accepted in `opts` so callers pass their resolved
 * options uniformly, but it is intentionally ignored for seed derivation.
 *
 * Non-superuser replay (Unit C): real Supabase Cloud hands users a privileged
 * NON-superuser `postgres`, so the seed must CREATE cleanly as a non-superuser.
 * Two fact classes cannot and are SKIPPED WHOLE (the engine never edits SQL text
 * — the fact is omitted, not rewritten):
 *   - `defaultPrivilege` (ADP): `ALTER DEFAULT PRIVILEGES FOR ROLE <r>` requires
 *     membership in <r>, which the applier lacks; an ADP entry only governs
 *     FUTURE creation by <r> so nothing a user file creates can depend on it.
 *   - a routine whose proconfig SETs a SUSET (superuser-context) GUC (e.g.
 *     `SET log_min_messages TO 'fatal'`): Postgres validates proconfig at CREATE
 *     time, so a non-superuser cannot create it AT ALL (SQLSTATE 42501). Detected
 *     via `susetGucs` ∩ the routine's structured `_configGucs` (from
 *     `pg_proc.proconfig`) — never by parsing the `def`. The one real occurrence
 *     on the Supabase surface is `realtime.list_changes`.
 * A seeded fact is reference-only on both sides, so its absence is symmetric and
 * cancels in the diff. If a user file genuinely references a skipped routine the
 * load fails LOUDLY at file:line with a precise missing-object error — acceptable
 * (user code essentially never calls these internal platform RPCs, and a clear
 * error beats rewritten SQL). `susetGucs` absent ⇒ nothing is skipped for this
 * reason (byte-identical behavior). Any fact that DEPENDS on a skipped routine is
 * transitively skipped too (it could not replay against a missing dependency).
 */
import { buildFactBase, type Fact, type FactBase } from "../core/fact.ts";
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

/** GUC names a routine's proconfig SETs, from the non-semantic `_configGucs`
 *  payload key (populated at extract time from `pg_proc.proconfig`). Empty when
 *  the routine SETs nothing. Read for the seed skip decision only — never used
 *  in the hash or diff (the key is `_`-prefixed). */
function configGucsOf(fact: Fact): string[] {
  const v = fact.payload["_configGucs"];
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

export function deriveAssumedSchemaSeed(
  targetFb: FactBase,
  opts: {
    policy?: Policy;
    capability?: ApplierCapability;
    /** The profile's diff-time baseline. Accepted so callers can pass their
     *  resolved options uniformly, but INTENTIONALLY NOT applied to seed
     *  derivation — see the module doc (Codex #323 finding 3). */
    baseline?: FactBase;
    assumedSchemas: string[];
    /** Policy assumed roles PLUS the target's own role names — same cluster, so
     *  every owner/grant role reference in the seed is present at replay. */
    assumedRoles: string[];
    /** Names of GUCs whose `pg_settings.context` requires superuser (queried from
     *  the TARGET, which shares the co-located shadow's cluster). A seeded routine
     *  whose structured `_configGucs` intersects this set carries a SET header
     *  clause that a non-superuser applier cannot CREATE (42501), so the whole
     *  routine fact — and anything depending on it — is OMITTED from the seed (see
     *  the module doc). Membership is CONTEXT-driven, not name-driven, so a
     *  user-context GUC like `search_path` is structurally absent and never
     *  triggers a skip. Absent ⇒ nothing skipped for this reason. */
    susetGucs?: ReadonlySet<string>;
  },
): AssumedSchemaSeed {
  // raw profile (no assumed schemas): nothing is platform-external, no seed.
  if (opts.assumedSchemas.length === 0) return EMPTY;

  // NB: opts.baseline is deliberately NOT passed — the seed derives from the RAW
  // target so baseline-identical platform objects (auth.users) stay in the view
  // and get seeded. See the module doc (Codex #323 finding 3).
  const view = resolveView(targetFb, opts.policy, opts.capability);
  const members = extensionMemberReferenceOnly(targetFb);
  const seedIds = new Set(
    [...view.referenceOnly].filter((id) => !members.has(id)),
  );
  if (seedIds.size === 0) return EMPTY;

  // Omit default-privilege (ADP) facts entirely: `ALTER DEFAULT PRIVILEGES FOR
  // ROLE <r>` needs membership in <r>, which a non-superuser applier lacks, and
  // an ADP entry has no possible dependents (see the module doc). Applies to ALL
  // roles — even an applier-owned ADP is unnecessary for elaboration.
  const keptFacts = view
    .facts()
    .filter(
      (f) => seedIds.has(encodeId(f.id)) && f.id.kind !== "defaultPrivilege",
    );
  const keptIds = new Set(keptFacts.map((f) => encodeId(f.id)));

  // Skip whole routines that carry a superuser-only SET header clause (they can't
  // be CREATEd by a non-superuser), decided from structured `_configGucs` — never
  // by editing the `def` SQL text. Then transitively skip any kept fact that
  // DEPENDS on a skipped one (it can't replay against a missing dependency).
  const excluded = new Set<string>();
  const suset = opts.susetGucs;
  if (suset && suset.size > 0) {
    for (const fct of keptFacts) {
      if (
        (fct.id.kind === "function" || fct.id.kind === "procedure") &&
        configGucsOf(fct).some((g) => suset.has(g))
      ) {
        excluded.add(encodeId(fct.id));
      }
    }
    if (excluded.size > 0) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const e of view.edges) {
          if (e.kind !== "depends") continue;
          const from = encodeId(e.from);
          if (
            keptIds.has(from) &&
            !excluded.has(from) &&
            excluded.has(encodeId(e.to))
          ) {
            excluded.add(from);
            changed = true;
          }
        }
      }
    }
  }

  const seedFacts =
    excluded.size > 0
      ? keptFacts.filter((f) => !excluded.has(encodeId(f.id)))
      : keptFacts;
  if (seedFacts.length === 0) return EMPTY;
  const finalIds = new Set(seedFacts.map((f) => encodeId(f.id)));
  const seedEdges = [...view.edges].filter(
    (e) => finalIds.has(encodeId(e.from)) && finalIds.has(encodeId(e.to)),
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
