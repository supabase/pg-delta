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
