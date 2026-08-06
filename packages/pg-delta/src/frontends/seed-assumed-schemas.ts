/**
 * Phase 2b (#41): derive the SQL that seeds a co-located shadow database with a
 * target's ASSUMED-SCHEMA objects (e.g. `auth.users` under `--profile
 * supabase`), so a user declarative dir that references those platform objects
 * can load into the otherwise-empty shadow.
 *
 * The managed view (`resolveView`) marks reference-only in ONE set: assumed
 * POLICY objects — assumed-schema objects (`auth.users`) and assumed platform
 * publications (`supabase_realtime`, #370: seeded EMPTY so a user file's
 * `ALTER PUBLICATION supabase_realtime ADD TABLE …` elaborates; membership
 * facts are managed, never seeded) — and extension members (`net.http_get`).
 * We seed only the former:
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
 * The seed is a REPLAYABLE SUBSET of the reference-only facts, not all of them.
 * It replays FIRST, into an empty shadow; the MANAGED objects only come into
 * existence afterwards, when the declarative files load. So a reference-only
 * overlay that DEPENDS on managed state (the field case: a policy on an assumed
 * `storage.objects` whose expression calls a user function in a managed `app`
 * schema) simply cannot replay during the seed phase — PostgreSQL fails the
 * whole seed with `schema "app" does not exist`. Such a candidate is OMITTED
 * WHOLE, together with everything that depends on it and everything it
 * structurally contains. Omitting it is safe and symmetric: generic diffing
 * skips a fact that is reference-only on EITHER side, so a shadow that lacks it
 * plans no create and no drop. No SQL is parsed, inspected semantically, or
 * rewritten to make such a fact replayable — the fact is dropped from the seed
 * set or it is replayed verbatim, never anything in between.
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
 * reason (byte-identical behavior).
 *
 * All omission reasons (managed dependency, suset-GUC routine, ADP, extension
 * member) feed ONE exclusion closure, so a fact that depends on — or is
 * structurally contained by — an omitted fact is omitted too, whatever the
 * original reason was.
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
  /** Encoded stable ids of the routine facts the seed ACTUALLY created
   *  (function / procedure / aggregate), mapped to each routine's seeded
   *  `def` (the `pg_get_functiondef` text carried on the fact payload). Passed
   *  to `loadSqlFiles` so its post-load body-validation pass can tell a seeded
   *  platform routine (warn on a wonky reconstruction) from a USER-authored
   *  routine that merely lives in a seeded schema NAME — the latter, including a
   *  new overload or a CREATE OR REPLACE of a seeded routine, must fail loudly
   *  (Codex #329). Scoping by full overload-safe identity (not schema name) is
   *  why the encoded id is used; the def value guards against an OR-REPLACE that
   *  keeps the identity but changes the body. */
  seededRoutines: Map<string, string>;
}

const EMPTY: AssumedSchemaSeed = {
  sql: "",
  facts: 0,
  schemas: [],
  seededRoutines: new Map(),
};

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
    /** Policy assumed publications (e.g. `supabase_realtime`). Used only to
     *  decide whether seeding applies at all — the seed SET still derives
     *  generically from the view's reference-only marks. Without this, a
     *  profile assuming ONLY publications would short-circuit on the empty
     *  assumedSchemas and silently derive no seed (Codex review on #373). */
    assumedPublications?: string[];
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
  // raw profile (no assumed objects of any kind): nothing is
  // platform-external, no seed.
  if (
    opts.assumedSchemas.length === 0 &&
    (opts.assumedPublications ?? []).length === 0
  ) {
    return EMPTY;
  }

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
  const candidateFacts = view
    .facts()
    .filter(
      (f) => seedIds.has(encodeId(f.id)) && f.id.kind !== "defaultPrivilege",
    );
  const candidateIds = new Set(candidateFacts.map((f) => encodeId(f.id)));

  // Candidates the seed materializes as a bare SHELL, because at least one of
  // their subsidiary facts is NOT a candidate (managed membership). Extract
  // collapses a subsidiary catalog row onto its owning object's id — e.g.
  // `pg_publication_rel` resolves to the PUBLICATION id
  // (src/extract/dependencies.ts's `pubrel` CTE) — so such a container INHERITS
  // its members' `depends` edges even though membership lives in a separate child
  // fact (`publicationRel`) the seed never creates. A shell's inherited edge is
  // therefore NOT a replay requirement: `CREATE PUBLICATION supabase_realtime`
  // with no `FOR TABLE` needs none of its members (#370 seeds it EMPTY on
  // purpose). Computed by walking each NON-candidate view fact up to its
  // candidate ancestors.
  const shellIds = new Set<string>();
  for (const fct of view.facts()) {
    if (candidateIds.has(encodeId(fct.id))) continue;
    let ancestor = fct.parent;
    while (ancestor !== undefined) {
      const key = encodeId(ancestor);
      if (candidateIds.has(key)) shellIds.add(key);
      ancestor = view.get(ancestor)?.parent;
    }
  }

  // INITIAL exclusions — the reasons a candidate cannot be replayed at seed time
  // at all. They all feed the SAME closure below, so a future reason needs no new
  // cascade logic.
  const excludedIds = new Set<string>();

  // (1) MANAGED dependency: the candidate `depends` on a fact that is in the
  //     managed view but is neither a seed candidate nor reference-only, i.e. an
  //     object the declarative files create LATER. The seed replays into an empty
  //     shadow, so that object does not exist yet and the statement fails (field
  //     case: `schema "app" does not exist`). Two target classes stay allowed:
  //       - a reference-only NON-candidate (extension member, ADP) — ambient in
  //         the co-located shadow (or with no replay meaning), which is the
  //         existing contract the plan's requirement guard already exempts via
  //         `assumedSchemas`;
  //       - anything a SHELL candidate inherited from a non-seeded subsidiary
  //         (see `shellIds`) — the shell's own DDL does not reference it.
  for (const e of view.edges) {
    if (e.kind !== "depends") continue;
    const from = encodeId(e.from);
    if (!candidateIds.has(from) || excludedIds.has(from)) continue;
    if (shellIds.has(from)) continue;
    const to = encodeId(e.to);
    if (candidateIds.has(to) || view.referenceOnly.has(to)) continue;
    excludedIds.add(from);
  }

  // (2) whole routines that carry a superuser-only SET header clause (they can't
  //     be CREATEd by a non-superuser), decided from structured `_configGucs` —
  //     never by editing the `def` SQL text.
  const suset = opts.susetGucs;
  if (suset !== undefined && suset.size > 0) {
    for (const fct of candidateFacts) {
      if (
        (fct.id.kind === "function" || fct.id.kind === "procedure") &&
        configGucsOf(fct).some((g) => suset.has(g))
      ) {
        excludedIds.add(encodeId(fct.id));
      }
    }
  }

  // Cascade every initial exclusion to a fixpoint over TWO relations:
  //   - `depends` edges: any candidate DEPENDING on an excluded one (it can't
  //     replay against a missing dependency);
  //   - structural containment (`Fact.parent`): a container fact's CHILD facts
  //     (e.g. a view's columns) are not linked by a `depends` edge at all — they
  //     are linked by `Fact.parent` — so excluding the container without also
  //     excluding its descendants would leave orphaned children in `seedFacts`;
  //     the flat filter below would let them through and `buildFactBase` would
  //     hard-throw "references missing parent".
  // The two relations interact: `pg_depend` endpoints can resolve to a
  // COLUMN-level id (src/extract/dependencies.ts's `resolved` CTE,
  // `objsubid > 0`), so a `depends` edge can point AT a column. A column
  // excluded structurally (because its parent view was excluded) can therefore
  // be the very fact another candidate `depends` on, which the edge pass must
  // then pick up — hence a combined fixpoint, not one pass of each.
  if (excludedIds.size > 0) {
    const parentOf = new Map<string, string>();
    for (const fct of candidateFacts) {
      if (fct.parent !== undefined) {
        parentOf.set(encodeId(fct.id), encodeId(fct.parent));
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of view.edges) {
        if (e.kind !== "depends") continue;
        const from = encodeId(e.from);
        if (
          candidateIds.has(from) &&
          !excludedIds.has(from) &&
          excludedIds.has(encodeId(e.to))
        ) {
          excludedIds.add(from);
          changed = true;
        }
      }
      for (const fct of candidateFacts) {
        const encoded = encodeId(fct.id);
        if (excludedIds.has(encoded)) continue;
        let ancestor = parentOf.get(encoded);
        while (ancestor !== undefined) {
          if (excludedIds.has(ancestor)) {
            excludedIds.add(encoded);
            changed = true;
            break;
          }
          ancestor = parentOf.get(ancestor);
        }
      }
    }
  }

  const seedFacts =
    excludedIds.size > 0
      ? candidateFacts.filter((f) => !excludedIds.has(encodeId(f.id)))
      : candidateFacts;
  if (seedFacts.length === 0) return EMPTY;
  const finalIds = new Set(seedFacts.map((f) => encodeId(f.id)));

  // Defensive invariant: the edge filter below narrows `view.edges` to intra-seed
  // edges, which would SILENTLY discard the evidence of an unsatisfied dependency
  // and let PostgreSQL discover it at replay time instead. Nothing in the final
  // seed set may still depend on a MANAGED fact outside it — the closure above
  // exists precisely to guarantee that, so a violation is an engine bug, not user
  // input. (Reference-only targets outside the seed remain allowed: they are
  // ambient in the co-located shadow.)
  for (const e of view.edges) {
    if (e.kind !== "depends") continue;
    const from = encodeId(e.from);
    if (!finalIds.has(from) || shellIds.has(from)) continue;
    const to = encodeId(e.to);
    if (finalIds.has(to) || view.referenceOnly.has(to)) continue;
    if (view.getByEncoded(to) === undefined) continue;
    throw new Error(
      `deriveAssumedSchemaSeed: seed fact ${from} still depends on managed fact ` +
        `${to}, which the seed does not create; the exclusion closure is incomplete`,
    );
  }

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
  // Overload-safe identity map of the routines the seed actually created, keyed
  // by encoded id → seeded `def`. Consumed by `loadSqlFiles`'s body-validation
  // pass to scope leniency to genuinely-seeded routines (see the field doc).
  const seededRoutines = new Map<string, string>();
  for (const f of seedFacts) {
    if (
      f.id.kind === "function" ||
      f.id.kind === "procedure" ||
      f.id.kind === "aggregate"
    ) {
      const def = f.payload["def"];
      seededRoutines.set(encodeId(f.id), typeof def === "string" ? def : "");
    }
  }
  return {
    sql: renderPlanSql(seedPlan),
    facts: seedFacts.length,
    schemas,
    seededRoutines,
  };
}
