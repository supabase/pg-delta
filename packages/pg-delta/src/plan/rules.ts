/**
 * The rule table (target-architecture §3.4): the ONLY per-kind logic in the
 * system. Structured data — functions confined to template slots
 * (guardrail 3). Each rule maps facts/attribute-changes to SQL plus the
 * dependency metadata the graph needs.
 */
import type { DependencyEdge, Fact } from "../core/fact.ts";
import type { PayloadValue } from "../core/hash.ts";
import type { StableId } from "../core/stable-id.ts";
import type { LockClass } from "./locks.ts";
import { constraintRules } from "./rules/constraints.ts";
import { foreignRules } from "./rules/foreign.ts";
import { indexRules } from "./rules/indexes.ts";
import { metadataRules } from "./rules/metadata.ts";
import { policyRules } from "./rules/policies.ts";
import { publicationRules } from "./rules/publications.ts";
import { roleRules } from "./rules/roles.ts";
import { routineRules } from "./rules/routines.ts";
import { schemaRules } from "./rules/schemas.ts";
import { sequenceRules } from "./rules/sequences.ts";
import { tableRules } from "./rules/tables.ts";
import { triggerRules } from "./rules/triggers.ts";
import { typeRules } from "./rules/types.ts";
import { viewRules } from "./rules/views.ts";

export interface ActionSpec {
  sql: string;
  /** extra consumed ids beyond the fact's parent (which is implicit) */
  consumes?: StableId[];
  /** additional fact ids this statement produces (delta-set inlining) */
  alsoProduces?: StableId[];
  /** ids this statement implicitly destroys even though no drop action
   *  exists for them (e.g. DROP IDENTITY removes the backing sequence) */
  alsoDestroys?: StableId[];
  /** ids this statement stops referencing (e.g. the OLD owner of an
   *  ALTER … OWNER TO) — the action must run before their destroyer */
  releases?: StableId[];
  dataLoss?: "none" | "destructive";
  rewriteRisk?: boolean;
  /** lock-class override for this specific DDL form (defaults come from
   *  the vetted (kind, verb) table in locks.ts) */
  lockClass?: LockClass;
  /** three-valued transactionality (§3.8). Default: "transactional".
   *  - nonTransactional: cannot run inside a transaction block at all
   *    (CREATE INDEX CONCURRENTLY, DROP SUBSCRIPTION with a slot)
   *  - commitBoundaryAfter: runs in a transaction but its effect is not
   *    usable before commit (ALTER TYPE … ADD VALUE) — the executor forces
   *    a segment boundary before any consumer of what it touched */
  transactionality?:
    | "transactional"
    | "nonTransactional"
    | "commitBoundaryAfter";
  /** compaction (§3.6): this statement is a clause that may fold into the
   *  CREATE of `foldInto` when no graph edge crosses the merge */
  compaction?: { foldInto: StableId; clause: string };
  /** this CREATE accepts column-clause folds (bare CREATE TABLE only) */
  acceptsColumnFolds?: boolean;
}

/** Named serialize parameters the rule table consumes. Policies (stage 8)
 *  set them; referencing an unknown name is a plan-time error, not a
 *  silent no-op. */
export const KNOWN_PARAMS: ReadonlySet<string> = new Set(["concurrentIndexes"]);
export type PlanParams = Record<string, unknown>;

export type AttributeRule =
  | {
      alter: (
        fact: Fact,
        from: PayloadValue,
        to: PayloadValue,
        view: FactView,
        sourceView: FactView,
      ) => ActionSpec | ActionSpec[];
      /** When this transition force-rebuilds surviving dependents (drop +
       *  recreate around the alter):
       *   - `true`  → every rebuildable dependent (enum value-set migration:
       *     views/defaults/routines must be out of the way)
       *   - `string[]` → only dependents of these kinds (ALTER COLUMN TYPE is
       *     blocked by views/rules/policies but NOT indexes/constraints,
       *     which PostgreSQL rebuilds itself — force-dropping a PK with
       *     dependent FKs would cascade harmfully)
       *   - `false`/absent → none */
      rebuildsDependents?: (
        from: PayloadValue,
        to: PayloadValue,
      ) => boolean | readonly string[];
      /** When a specific transition has no in-place ALTER grammar, route the
       *  WHOLE fact to replace (drop + recreate) instead of emitting `alter` —
       *  e.g. unsetting a foreign server VERSION, or SET SCHEMA on a
       *  non-relocatable extension. Evaluated during replacement classification;
       *  the fact is then dropped + recreated (its `alter` never runs). */
      replaceWhen?: (
        from: PayloadValue,
        to: PayloadValue,
        fact: Fact,
      ) => boolean;
    }
  | "replace";

/** Read-only view over the desired state, for rules that inline children. */
export interface FactView {
  childrenOf(id: StableId): Fact[];
  facts(): Fact[];
  get(id: StableId): Fact | undefined;
  /** Outgoing dependency edges of `id` (with kind), so a rule can order its
   *  action after the objects the fact references — e.g. a routine's def-alter
   *  consuming its `depends` targets for BEGIN ATOMIC body validation. */
  outgoingEdges(id: StableId): readonly DependencyEdge[];
  readonly edges: readonly { from: StableId; to: StableId }[];
  /** Whether `id` is present for REFERENCE ONLY (kept in the view so dependents
   *  resolve, but never itself created/dropped/altered — e.g. an assumed-schema
   *  platform object). Lets a rule tell "present on the target" from "produced
   *  by this plan". */
  isReferenceOnly(id: StableId): boolean;
}

export interface KindRules {
  /** `sourceView` is the resolved SOURCE (target) view, so a rule can decide by
   *  plan-time presence — e.g. CREATE EXTENSION omits `SCHEMA s` when schema `s`
   *  is neither on the target nor produced by this plan (the extension creates
   *  it). Optional so existing single-arg rules stay type-compatible. */
  create(
    fact: Fact,
    view: FactView,
    params?: PlanParams,
    sourceView?: FactView,
  ): ActionSpec[];
  drop(fact: Fact): ActionSpec;
  /** rename support (stage 9): render the in-place rename from the old
   *  fact to the new id. Kinds without this member never become rename
   *  candidates (their changes stay drop+create). */
  rename?: (fact: Fact, to: StableId) => ActionSpec;
  attributes: Record<string, AttributeRule>;
  /** kind weight for deterministic tie-breaking (pg_dump-inspired) */
  weight: number;
  /** Returns the `ALTER <KIND> <identifier>` prefix WITHOUT ` OWNER TO …`,
   *  used by the planner to emit owner actions from owner-edge link deltas.
   *  Absent for kinds that are not ownable (have no ALTER … OWNER TO). */
  ownerAlterPrefix?: (fact: Fact) => string;

  // ── graph/suppression policy (guardrail 3: per-kind knowledge lives
  //    HERE, never in the planner body) ──────────────────────────────────
  /** this fact vanishes with its parent regardless of the parent's kind
   *  (comment, acl) — a metadata satellite */
  metadata?: boolean;
  /** a DROP of this kind cascades to its children in PostgreSQL, so child
   *  drops fold into it (table, view, type, …). schema/role do NOT cascade. */
  cascadesToChildren?: boolean;
  /** a surviving dependent of a destroyed fact of this kind is force-
   *  rebuilt (drop + recreate from the desired state) */
  rebuildable?: boolean;
  /** whether a fact of this kind MAY be folded into a parent's cascading
   *  drop. Default true. FK constraints return false: an explicit
   *  DROP CONSTRAINT first makes mutual-FK teardown cycles unconstructible. */
  suppressible?: (fact: Fact) => boolean;
  /** redirect this fact's drop to fold into a NON-parent ancestor's drop
   *  when that ancestor is being removed (an OWNED BY sequence folds into
   *  its owning column/table, which is not its catalog parent). */
  dropRootRedirect?: (
    fact: Fact,
    isRemoved: (id: StableId) => boolean,
  ) => StableId | undefined;
  /** pg_default_acl objtype char for the default-privilege hygiene pass
   *  (table/view/matview/foreignTable → 'r', sequence → 'S',
   *  procedure/aggregate → 'f'); absent for kinds with no default ACLs */
  defaclObjtype?: string;
}

/**
 * The rule registry: the single planner-facing interface (guardrail 3).
 * Per-kind logic lives in the per-family modules under `./rules/`; this object
 * is their composition. Family files import the types above type-only, so the
 * runtime import graph (rules → family → helpers → render) carries no cycle.
 */
export const RULES: Record<string, KindRules> = {
  ...roleRules,
  ...schemaRules,
  ...tableRules,
  ...sequenceRules,
  ...constraintRules,
  ...indexRules,
  ...routineRules,
  ...typeRules,
  ...viewRules,
  ...triggerRules,
  ...policyRules,
  ...publicationRules,
  ...foreignRules,
  ...metadataRules,
};

export function rulesFor(kind: string): KindRules {
  const rules = RULES[kind];
  if (!rules) {
    throw new Error(
      `rule table: no rules for kind '${kind}' — extend the rule vocabulary (guardrail 3)`,
    );
  }
  return rules;
}

// ── extension intent (docs/architecture/extension-intent.md §4) ───────────────
// A stateful extension's intent (a pg_cron job, a future pgmq queue, …) is an
// ordinary fact of the single generic `extensionIntent` kind. Its rules live in
// the integration layer (a handler's `intentKinds`), resolved per-plan through
// the profile — NEVER mutated into the global RULES table (that would be shared
// mutable state across the corpus's many plans). rules.ts stays the single
// lookup seam; the intent index is an ARGUMENT to that seam (guardrail 3).

/** The intent counterpart of `KindRules`: a narrow, data-shaped replay rule for
 *  one `(ext, intentKind)`. ActionSpec-shaped so replays reuse the SAME action
 *  metadata grammar (consumes/dataLoss/transactionality) as schema rules — no
 *  second action vocabulary (docs §4.1 deviation, resolved toward the code). */
export interface IntentKindRule {
  /** replay that (re)creates the intent, e.g. `select cron.schedule(...)`. The
   *  `view` is the desired-state view (unused by simple replays like cron). */
  create(fact: Fact, view: FactView): ActionSpec[];
  /** replay that removes the intent, e.g. `select cron.unschedule(...)`. */
  drop(fact: Fact): ActionSpec;
  /** the payload attributes this intent recognises. EVERY listed attribute is
   *  treated as `"replace"`: extension intent has no in-place ALTER, so any
   *  change replays as drop+create by key (docs §3.2). A changed attribute NOT
   *  listed here trips the "extend the rule vocabulary" guard in
   *  replacement-expansion — payload evolution fails loudly, never silently. */
  readonly payloadAttrs: readonly string[];
  /** tie-break weight; defaults to {@link INTENT_DEFAULT_WEIGHT} — later than
   *  every schema kind, so replay orders after all schema DDL (docs §4.5). */
  weight?: number;
}

/** Later than every schema kind's weight (the max schema weight is far below
 *  this), so intent replays sort after all schema DDL on ties (docs §4.5). */
export const INTENT_DEFAULT_WEIGHT = 90;

/** An intent-rule index keyed by `${ext}\x00${intentKind}`, each value a
 *  `KindRules` adapter the generic planner dispatches exactly like a schema
 *  kind. */
export type IntentRuleIndex = ReadonlyMap<string, KindRules>;

/** A rule resolver keyed by the whole id: schema kinds resolve by `id.kind`,
 *  `extensionIntent` by `(id.ext, id.intentKind)`. */
export type RulesForId = (id: StableId) => KindRules;

function intentKey(ext: string, intentKind: string): string {
  return `${ext}\x00${intentKind}`;
}

/** Wrap an `IntentKindRule` as a `KindRules` so the generic planner dispatches
 *  it like any schema kind. Extension-intent facts have no children, satellites,
 *  renames, owners, or default ACLs, so every OPTIONAL `KindRules` member is
 *  omitted — the planner's undefined-guards then skip rename candidacy,
 *  default-privilege hygiene, owner emission, and folding. `lockClass: "none"`
 *  is injected as the per-spec default (a `select <ext>.<fn>()` replay takes no
 *  lock on an existing user relation); a rule may still override per spec. */
function intentRuleToKindRules(rule: IntentKindRule): KindRules {
  const attributes: Record<string, AttributeRule> = {};
  for (const attr of rule.payloadAttrs) attributes[attr] = "replace";
  const withLock = (spec: ActionSpec): ActionSpec => ({
    lockClass: "none",
    ...spec,
  });
  return {
    create: (fact, view) => rule.create(fact, view).map(withLock),
    drop: (fact) => withLock(rule.drop(fact)),
    attributes,
    weight: rule.weight ?? INTENT_DEFAULT_WEIGHT,
  };
}

/** Build the intent-rule index from a profile's handlers. Handlers without
 *  `intentKinds` (filter-only Phase-A handlers like pg_partman) contribute
 *  nothing. */
export function buildIntentRuleIndex(
  handlers: ReadonlyArray<{
    extension: string;
    intentKinds?: Record<string, IntentKindRule>;
  }>,
): IntentRuleIndex {
  const index = new Map<string, KindRules>();
  for (const handler of handlers) {
    if (handler.intentKinds === undefined) continue;
    for (const [intentKind, rule] of Object.entries(handler.intentKinds)) {
      index.set(
        intentKey(handler.extension, intentKind),
        intentRuleToKindRules(rule),
      );
    }
  }
  return index;
}

/** Build the per-plan rule resolver. Schema kinds resolve through the static
 *  {@link RULES} table (via {@link rulesFor}); `extensionIntent` ids resolve
 *  through the profile-supplied `intentRules` by `(ext, intentKind)`. An intent
 *  id with no registered rule throws — a plan cannot silently drop declared
 *  intent it has no rule for. */
export function buildRuleResolver(intentRules?: IntentRuleIndex): RulesForId {
  return (id: StableId): KindRules => {
    if (id.kind === "extensionIntent") {
      const rules = intentRules?.get(intentKey(id.ext, id.intentKind));
      if (rules === undefined) {
        throw new Error(
          `rule table: no intent rule registered for extension '${id.ext}' ` +
            `intent kind '${id.intentKind}' — register the handler's intentKinds ` +
            `via the integration profile`,
        );
      }
      return rules;
    }
    return rulesFor(id.kind);
  };
}

/** The default resolver with no intent rules — for direct callers/tests that
 *  never see intent facts (the corpus). An intent id throws through it. */
export const defaultRulesForId: RulesForId = buildRuleResolver();
