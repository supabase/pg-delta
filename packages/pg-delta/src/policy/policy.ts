/**
 * Policy DSL v2: filtering, serialization parameters, and policy composition
 * (target-architecture §3.9, stage-08-policy).
 *
 * Predicates are PURE DATA — no function-valued fields — so policies are
 * fully serializable to JSON and embeddable in plan artifacts (policyId +
 * inline policy for reproducibility).
 *
 * Evaluation model:
 *   - Filter rules: first-match-wins; no match → include.
 *   - Serialize rules: first-match-wins; contributes params once matched.
 *   - extends composition: own rules first, parent rules appended after.
 *   - Cycle detection by policy id; detected cycles throw.
 *
 * ## Deliberate vocabulary extensions (stage-8 pitfall: extend deliberately and log)
 *
 * The following predicates were added to support the Supabase policy rules that
 * could not be expressed with the initial vocabulary:
 *
 * ### `{ owner: string | string[] }`
 * Matches when the fact's `owner` edge (object --owner--> role, move 2) points
 * to a role whose name matches any of the given globs. Needed for: excluding
 * objects whose owner is a Supabase system role (the old "star/owner" deny-list
 * rule in supabase.ts).
 *
 * ### `{ idField: { field: string; glob: string | string[] } }`
 * Generic identity-field matcher: reads `(fact.id as Record<string, unknown>)[field]`,
 * then checks it is a string matching any glob. Covers:
 *   - `member` on membership facts (exclude memberships where member is a system role)
 *   - `role` on membership facts (exclude memberships where role is a system role)
 *   - `table` on trigger/policy/etc. (filter triggers on pgmq queue tables)
 *
 * ### `{ target: { kind?: string|string[]; schema?: string|string[]; name?: string|string[] } }`
 * For satellite facts (acl, comment, securityLabel) whose id has a `target: StableId`
 * field: matches when ALL provided sub-fields match the target's corresponding fields.
 * Each sub-field is optional, glob-matched, and accepts a single value or an array.
 *   - `kind` matches target.kind (exact, no glob — kinds are enum values)
 *   - `schema` matches target.schema via glob
 *   - `name` matches target.name via glob
 * Replaces the three earlier satellite predicates targetKind/targetSchema/targetName.
 *
 * ### `{ edgeTo: { edgeKind?: EdgeKind; kind?: string; schema?: string | string[]; name?: string | string[] } }`
 * Matches when the fact has an outgoing edge of the given `edgeKind`
 * (provenance: depends / owner / memberOfExtension / managedBy) and/or to a
 * fact whose id.kind equals `kind` and/or whose id `schema` / `name` match a
 * glob. Needed for: detecting user-created triggers whose function lives in a
 * non-managed schema (edgeTo {kind: "function", schema: not in
 * SYSTEM_SCHEMAS}), provenance filtering of operationally-managed
 * objects (edgeTo {edgeKind: "managedBy"}), and pinning a dependency to a
 * NAMED fact — a wrappers-provisioned FDW depends on the `wrappers`
 * extension because pg_depend endpoint resolution collapses its
 * extension-member handler/validator onto the extension fact (CLI-1470).
 *
 * ### `{ partitionOf: { schema?: string | string[]; name?: string | string[] } }`
 * Matches a declarative partition child: a fact whose payload carries a
 * non-null `partitionBound` (exactly `pg_class.relispartition` — the extractor
 * sets it from `pg_get_expr(relpartbound)`), optionally pinned to a parent
 * whose `payload.parentTable` schema/name match the given globs. Needed for:
 * excluding operational partition churn from a managed view (Realtime's daily
 * `realtime.messages` partitions — the old DSL's `table/is_partition`, #346).
 * Prefer the parent-pinned form: "is a partition" alone cannot tell service
 * churn from a user-declared `PARTITION OF` (the pg_partman CLI-1591 lesson).
 * A legacy INHERITS child has `parentTable` but no bound, so it does NOT match.
 *
 * `validatePolicy` rejects an `idField` naming an unknown identity field, so a
 * typo fails loudly instead of silently never matching (review #7).
 */

import type { Delta } from "../core/diff.ts";
import type { DependencyEdge, EdgeKind, Fact, FactBase } from "../core/fact.ts";
import { contentHash, type PayloadValue } from "../core/hash.ts";
import { buildFactBase, retainOwnerRoleDangling } from "../core/fact.ts";
import type { FactKind, StableId } from "../core/stable-id.ts";
import { encodeId } from "../core/stable-id.ts";
import { KNOWN_PARAMS, type PlanParams } from "../plan/rules.ts";
import { subtractBaseline } from "./baseline.ts";
import {
  collectRemovedSuppressions,
  excludeFactsAndDescendants,
  extensionMemberClosure,
  type ProjectionAuditClassification,
  type ProjectionSuppressionAttribution,
  type ProjectionSuppressionCollector,
} from "./view.ts";
import {
  capabilityExcludedRoots,
  type ApplierCapability,
} from "./capability.ts";

// ---------------------------------------------------------------------------
// Predicate vocabulary
// ---------------------------------------------------------------------------

/** Match by fact kind (one or many). */
export type KindPredicate = { kind: string | string[] };

/**
 * Match by identity field "schema" (glob supported, * = any sequence).
 * Accepts a single glob string OR an array of globs (matches if any glob matches).
 */
export type SchemaPredicate = { schema: string | string[] };

/**
 * Match by identity field "name" (glob supported).
 * Accepts a single glob string OR an array of globs (matches if any glob matches).
 */
export type NamePredicate = { name: string | string[] };

/** Match by delta verb. */
export type VerbPredicate = {
  verb:
    | "add"
    | "remove"
    | "set"
    | "link"
    | "unlink"
    | Array<"add" | "remove" | "set" | "link" | "unlink">;
};

/**
 * Match when the fact (or for satellite facts, some fact in its parent chain)
 * has an outgoing "memberOfExtension" edge to an extension fact with the given
 * name. Uses FactBase.outgoingEdges.
 */
export type OwnedByExtensionPredicate = { ownedByExtension: string };

/** Match when the fact's parent id has the given kind. */
export type ParentKindPredicate = { parentKind: string };

/** All sub-predicates must match. */
export type AllPredicate = { all: Predicate[] };

/** At least one sub-predicate must match. */
export type AnyPredicate = { any: Predicate[] };

/** Negate the sub-predicate. */
export type NotPredicate = { not: Predicate };

/**
 * Match when the fact's `owner` edge points to a role whose name matches any of
 * the given globs (move 2: owner is an edge, not a payload field). Added for the
 * Supabase system-role owner exclusion rule.
 */
export type OwnerPredicate = { owner: string | string[] };

/**
 * Generic identity-field matcher: reads `(fact.id as Record<string, unknown>)[field]`,
 * then checks it is a string matching any of the given globs.
 * Added for membership.member, membership.role, trigger.table, etc.
 *
 * NOTE: This is the one intentional dynamic-field escape hatch in the DSL.
 * There is no compile-time check on `field`, but it is NOT silent: a field name
 * outside `KNOWN_ID_FIELDS` is rejected by validatePolicy (validateIdFields)
 * with a "references unknown identity field" error, so a typo fails fast.
 */
export type IdFieldPredicate = {
  idField: { field: string; glob: string | string[] };
};

/**
 * For satellite facts (acl, comment, securityLabel) whose id has a
 * `target: StableId` field: matches when ALL provided sub-fields match the
 * corresponding fields of the target StableId.
 *
 * All sub-fields are optional; only the provided ones are tested.
 * `kind` is tested by exact equality (kinds are enum values, not user strings).
 * `schema` and `name` are glob-matched; each accepts a single value or an array
 * (matches if any element matches).
 *
 * Replaces the three separate targetKind / targetSchema / targetName predicates.
 */
export type TargetPredicate = {
  target: {
    kind?: string | string[];
    schema?: string | string[];
    name?: string | string[];
  };
};

/**
 * Matches when the fact has an outgoing dependency edge (fb.outgoingEdges)
 * to a fact whose id.kind equals `kind` (if given) and/or whose id `schema`
 * / `name` fields match any glob (if given).
 * Added for user-trigger detection (edgeTo non-system procedure schema) and
 * extension-provenance filtering; `name` pins the edge to a NAMED target
 * (e.g. depends on the `wrappers` extension, CLI-1470).
 */
export type EdgeToPredicate = {
  edgeTo: {
    /** the edge's OWN kind (provenance): "depends" | "owner" |
     *  "memberOfExtension" | "managedBy". Without it, edges of any kind match. */
    edgeKind?: EdgeKind;
    kind?: string;
    schema?: string | string[];
    name?: string | string[];
  };
};

/**
 * Matches a declarative partition child: a fact whose payload has a non-null
 * `partitionBound` (⇔ `pg_class.relispartition`), optionally pinned to a
 * parent whose `payload.parentTable` matches the given schema/name globs.
 *
 * All sub-fields are optional; `{ partitionOf: {} }` matches ANY partition
 * (the old filter DSL's `table/is_partition: true`). Prefer pinning the parent
 * (`{ partitionOf: { schema: "realtime", name: "messages" } }`): it states
 * WHOSE partitions are operational churn instead of hiding every partition,
 * and the projection audit classifies the pinned form as a named-object
 * selector. A legacy INHERITS child (parentTable without a bound) never
 * matches.
 */
export type PartitionOfPredicate = {
  partitionOf: {
    schema?: string | string[];
    name?: string | string[];
  };
};

export type Predicate =
  | KindPredicate
  | SchemaPredicate
  | NamePredicate
  | VerbPredicate
  | OwnedByExtensionPredicate
  | ParentKindPredicate
  | AllPredicate
  | AnyPredicate
  | NotPredicate
  | OwnerPredicate
  | IdFieldPredicate
  | TargetPredicate
  | EdgeToPredicate
  | PartitionOfPredicate;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * A filter rule: if the predicate matches, the delta is either excluded or
 * included (first-match-wins; no rule matches → include).
 */
export interface FilterRule {
  match: Predicate;
  action: "exclude" | "include";
  /** Stable projection-audit metadata. Optional for backward compatibility:
   * unannotated rules receive a policy-id/semantic-hash reason code and are classified
   * from their matcher (concrete named-object selector → acknowledged;
   * generic/wildcard selector → suspicious). */
  audit?: {
    reasonCode?: string;
    classification?: ProjectionAuditClassification;
  };
}

/**
 * A serialize rule: if the predicate matches, the given params are contributed
 * to the effective PlanParams (first-matching rule wins per param key).
 */
export interface SerializeRule {
  match: Predicate;
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface Policy {
  id: string;
  filter?: FilterRule[];
  serialize?: SerializeRule[];
  baseline?: string;
  extends?: Policy[];
  /**
   * Role names assumed to exist at apply time but NOT managed by this policy —
   * platform-preset roles (e.g. Supabase's `anon`, `authenticated`) whose role
   * OBJECT is filtered out of the managed view, yet which remain valid grant /
   * ownership targets. The planner treats these like `pg_*` / `PUBLIC`: a
   * `consumes` edge to one does not strand the missing-requirement guard. This
   * lets the engine emit `GRANT … TO anon` (which old pg-delta and dbdev rely
   * on) without re-admitting the role into the diff.
   */
  assumedRoles?: string[];
  /**
   * Schema names assumed to exist at apply time but NOT managed by this policy —
   * platform-managed schemas (e.g. Supabase's `extensions`) whose schema OBJECT
   * is filtered out of the managed view, yet which remain valid dependency
   * targets. The planner treats these like assumed roles / `pg_*` / `PUBLIC`: a
   * `consumes` edge to one does not strand the missing-requirement guard. This
   * lets the engine emit `CREATE EXTENSION … SCHEMA extensions` (which old
   * pg-delta and dbdev rely on) without re-admitting the schema into the diff.
   */
  assumedSchemas?: string[];
  /**
   * Publication names assumed to exist at apply time but NOT managed by this
   * policy — platform-created publications (e.g. Supabase's
   * `supabase_realtime`) whose publication OBJECT is filtered out of the
   * managed view, yet whose MEMBERSHIP (`publicationRel` /
   * `publicationSchema` children) stays user-managed: users run `ALTER
   * PUBLICATION supabase_realtime ADD TABLE …` without ever owning the
   * publication itself. A scope-excluded publication named here is kept
   * REFERENCE-ONLY (like assumed-schema objects) instead of hard-pruned, so
   * its member facts survive and diff at rel grain while the object is never
   * created, dropped, or altered (#370).
   */
  assumedPublications?: string[];
  /**
   * The role whose object ownership stays IMPLICIT in a database-scope export:
   * `schema export` suppresses `ALTER … OWNER TO <defaultOwner>` (that role is the
   * expected applier), while every object owned by another role serializes its
   * owner. Consumed as the profile-declared tier of the `--default-owner` chain
   * (flag > profile default > database `datdba`). Undefined → fall through to the
   * database owner. Supabase sets this to `postgres`.
   */
  defaultOwner?: string;
}

// ---------------------------------------------------------------------------
// Glob helpers (no regex library; implement ourselves)
// ---------------------------------------------------------------------------

/** Escape all regex meta-characters except `*`, then replace `*` with `.*`. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexSource = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regexSource}$`);
}

function globMatch(pattern: string, value: string): boolean {
  return globToRegex(pattern).test(value);
}

// ---------------------------------------------------------------------------
// Identity field extraction helpers
// ---------------------------------------------------------------------------

function getSchema(id: StableId): string | undefined {
  if ("schema" in id && typeof id.schema === "string") return id.schema;
  return undefined;
}

function getName(id: StableId): string | undefined {
  if ("name" in id && typeof id.name === "string") return id.name;
  return undefined;
}

// ---------------------------------------------------------------------------
// Parent chain traversal (for ownedByExtension, parentKind)
// ---------------------------------------------------------------------------

/**
 * Walk the parent chain of a fact id upward in `fb`.
 * Returns all facts in the chain including the fact itself.
 */
function parentChain(id: StableId, fb: FactBase): Fact[] {
  const chain: Fact[] = [];
  let current: StableId | undefined = id;
  while (current !== undefined) {
    const fact = fb.get(current);
    if (!fact) break;
    chain.push(fact);
    current = fact.parent;
  }
  return chain;
}

/**
 * Check if any fact in the parent chain (inclusive) has an outgoing
 * "memberOfExtension" edge to an extension with the given name.
 */
function isOwnedByExtension(
  id: StableId,
  extensionName: string,
  fb: FactBase,
): boolean {
  const chain = parentChain(id, fb);
  for (const fact of chain) {
    const outgoing = fb.outgoingEdges(fact.id);
    for (const edge of outgoing) {
      if (
        edge.kind === "memberOfExtension" &&
        edge.to.kind === "extension" &&
        (edge.to as { kind: "extension"; name: string }).name === extensionName
      ) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core predicate evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a predicate against a Fact in a FactBase.
 *
 * For satellite (child) facts, `ownedByExtension` walks the parent chain so
 * that objects belonging to extension-owned parents are also covered.
 */
export function factMatches(
  predicate: Predicate,
  fact: Fact,
  view: FactBase,
  opts?: { verbAssumed?: boolean },
): boolean {
  // Combinators
  if ("all" in predicate) {
    return predicate.all.every((p) => factMatches(p, fact, view, opts));
  }
  if ("any" in predicate) {
    return predicate.any.some((p) => factMatches(p, fact, view, opts));
  }
  if ("not" in predicate) {
    return !factMatches(predicate.not, fact, view, opts);
  }

  // kind
  if ("kind" in predicate) {
    const kinds = Array.isArray(predicate.kind)
      ? predicate.kind
      : [predicate.kind];
    return kinds.some((k) => fact.id.kind === k);
  }

  // schema
  if ("schema" in predicate) {
    const schema = getSchema(fact.id);
    if (schema === undefined) return false;
    const patterns = Array.isArray(predicate.schema)
      ? predicate.schema
      : [predicate.schema];
    return patterns.some((p) => globMatch(p, schema));
  }

  // name
  if ("name" in predicate) {
    const name = getName(fact.id);
    if (name === undefined) return false;
    const patterns = Array.isArray(predicate.name)
      ? predicate.name
      : [predicate.name];
    return patterns.some((p) => globMatch(p, name));
  }

  // verb — not a property of a bare fact. By default no-match; under
  // `verbAssumed` (the resolveView protection check) treat as satisfiable.
  if ("verb" in predicate) {
    return opts?.verbAssumed === true;
  }

  // ownedByExtension
  if ("ownedByExtension" in predicate) {
    return isOwnedByExtension(fact.id, predicate.ownedByExtension, view);
  }

  // parentKind
  if ("parentKind" in predicate) {
    if (fact.parent === undefined) return false;
    return fact.parent.kind === predicate.parentKind;
  }

  // owner — resolves via the `owner` edge (object --owner--> role) emitted by
  // the extractor (move 2). Falls back to payload["owner"] for callers that
  // still pass synthetic fact bases without edges (backward compat / tests).
  if ("owner" in predicate) {
    const ownerEdge = view
      .outgoingEdges(fact.id)
      .find((e) => e.kind === "owner");
    const ownerVal =
      ownerEdge?.to.kind === "role"
        ? (ownerEdge.to as { kind: "role"; name: string }).name
        : (fact.payload["owner"] as string | undefined);
    if (typeof ownerVal !== "string") return false;
    const patterns = Array.isArray(predicate.owner)
      ? predicate.owner
      : [predicate.owner];
    return patterns.some((p) => globMatch(p, ownerVal));
  }

  // idField — reads (fact.id as Record)[field], matches any glob
  // NOTE: Intentional dynamic-field escape hatch. Typo'd field names silently
  // never match — there is no compile-time check for field name correctness.
  if ("idField" in predicate) {
    const rawId = fact.id as Record<string, unknown>;
    const fieldVal = rawId[predicate.idField.field];
    if (typeof fieldVal !== "string") return false;
    const globs = Array.isArray(predicate.idField.glob)
      ? predicate.idField.glob
      : [predicate.idField.glob];
    return globs.some((g) => globMatch(g, fieldVal));
  }

  // target — unified satellite-target predicate (replaces targetKind/targetSchema/targetName)
  // For satellite facts whose id has a `target: StableId` field.
  // All provided sub-fields must match (AND semantics); absent sub-fields are ignored.
  if ("target" in predicate) {
    const rawId = fact.id as Record<string, unknown>;
    const targetRaw = rawId["target"];
    if (targetRaw === null || typeof targetRaw !== "object") return false;
    const targetObj = targetRaw as Record<string, unknown>;

    const {
      kind: kindFilter,
      schema: schemaFilter,
      name: nameFilter,
    } = predicate.target;

    // kind sub-field: exact match (kinds are enum values)
    if (kindFilter !== undefined) {
      const targetKindVal = targetObj["kind"];
      if (typeof targetKindVal !== "string") return false;
      const kinds = Array.isArray(kindFilter) ? kindFilter : [kindFilter];
      if (!kinds.some((k) => k === targetKindVal)) return false;
    }

    // schema sub-field: glob match
    if (schemaFilter !== undefined) {
      const targetSchemaVal = targetObj["schema"];
      if (typeof targetSchemaVal !== "string") return false;
      const patterns = Array.isArray(schemaFilter)
        ? schemaFilter
        : [schemaFilter];
      if (!patterns.some((p) => globMatch(p, targetSchemaVal))) return false;
    }

    // name sub-field: glob match
    if (nameFilter !== undefined) {
      const targetNameVal = targetObj["name"];
      if (typeof targetNameVal !== "string") return false;
      const patterns = Array.isArray(nameFilter) ? nameFilter : [nameFilter];
      if (!patterns.some((p) => globMatch(p, targetNameVal))) return false;
    }

    return true;
  }

  // partitionOf — a declarative partition child (payload.partitionBound is
  // non-null exactly when pg_class.relispartition), optionally pinned to a
  // parent whose payload.parentTable schema/name match the given globs.
  if ("partitionOf" in predicate) {
    if (typeof fact.payload["partitionBound"] !== "string") return false;
    const { schema: schemaFilter, name: nameFilter } = predicate.partitionOf;
    if (schemaFilter === undefined && nameFilter === undefined) return true;
    const parentRaw = fact.payload["parentTable"];
    if (parentRaw === null || typeof parentRaw !== "object") return false;
    const parentObj = parentRaw as Record<string, unknown>;
    if (schemaFilter !== undefined) {
      const parentSchema = parentObj["schema"];
      if (typeof parentSchema !== "string") return false;
      const patterns = Array.isArray(schemaFilter)
        ? schemaFilter
        : [schemaFilter];
      if (!patterns.some((p) => globMatch(p, parentSchema))) return false;
    }
    if (nameFilter !== undefined) {
      const parentName = parentObj["name"];
      if (typeof parentName !== "string") return false;
      const patterns = Array.isArray(nameFilter) ? nameFilter : [nameFilter];
      if (!patterns.some((p) => globMatch(p, parentName))) return false;
    }
    return true;
  }

  // edgeTo — matches when outgoing edges contain one of the given edge kind
  // (provenance) and/or to a target of the given kind/schema
  if ("edgeTo" in predicate) {
    const outgoing = view.outgoingEdges(fact.id);
    for (const edge of outgoing) {
      if (
        predicate.edgeTo.edgeKind !== undefined &&
        edge.kind !== predicate.edgeTo.edgeKind
      ) {
        continue;
      }
      const toId = edge.to as Record<string, unknown>;
      if (
        predicate.edgeTo.kind !== undefined &&
        toId["kind"] !== predicate.edgeTo.kind
      ) {
        continue;
      }
      if (predicate.edgeTo.schema !== undefined) {
        const toSchema = toId["schema"];
        if (typeof toSchema !== "string") continue;
        const schemaPatterns = Array.isArray(predicate.edgeTo.schema)
          ? predicate.edgeTo.schema
          : [predicate.edgeTo.schema];
        if (!schemaPatterns.some((p) => globMatch(p, toSchema))) continue;
      }
      if (predicate.edgeTo.name !== undefined) {
        const toName = toId["name"];
        if (typeof toName !== "string") continue;
        const namePatterns = Array.isArray(predicate.edgeTo.name)
          ? predicate.edgeTo.name
          : [predicate.edgeTo.name];
        if (!namePatterns.some((p) => globMatch(p, toName))) continue;
      }
      return true;
    }
    return false;
  }

  // exhaustive — TypeScript narrows to never here in strict mode
  const _exhaustive: never = predicate;
  return _exhaustive;
}

/**
 * Resolve the "subject fact" for a delta:
 *   add    → delta.fact in desired
 *   remove → delta.fact in source
 *   set    → desired.get(delta.id)
 *   link / unlink → the edge's `from` fact, resolved from the appropriate base
 *
 * Returns undefined when the fact cannot be resolved (dangling).
 */
function subjectFact(
  delta: Delta,
  source: FactBase,
  desired: FactBase,
): { fact: Fact; view: FactBase } | undefined {
  switch (delta.verb) {
    case "add": {
      const f = desired.get(delta.fact.id) ?? delta.fact;
      return { fact: f, view: desired };
    }
    case "remove": {
      const f = source.get(delta.fact.id) ?? delta.fact;
      return { fact: f, view: source };
    }
    case "set": {
      const f = desired.get(delta.id);
      if (!f) return undefined;
      return { fact: f, view: desired };
    }
    case "link": {
      const f = desired.get(delta.edge.from) ?? source.get(delta.edge.from);
      if (!f) return undefined;
      return { fact: f, view: desired };
    }
    case "unlink": {
      const f = source.get(delta.edge.from) ?? desired.get(delta.edge.from);
      if (!f) return undefined;
      return { fact: f, view: source };
    }
  }
}

/**
 * Evaluate a predicate against a Delta, using both source and desired bases.
 *
 * The "verb" predicate tests delta.verb; all other predicates test the
 * subject fact (resolved per the convention above).
 */
export function deltaMatches(
  predicate: Predicate,
  delta: Delta,
  source: FactBase,
  desired: FactBase,
): boolean {
  // Combinators — recurse before resolving subject
  if ("all" in predicate) {
    return predicate.all.every((p) => deltaMatches(p, delta, source, desired));
  }
  if ("any" in predicate) {
    return predicate.any.some((p) => deltaMatches(p, delta, source, desired));
  }
  if ("not" in predicate) {
    return !deltaMatches(predicate.not, delta, source, desired);
  }

  // verb predicate matches directly on delta.verb
  if ("verb" in predicate) {
    const verbs = Array.isArray(predicate.verb)
      ? predicate.verb
      : [predicate.verb];
    return verbs.some((v) => v === delta.verb);
  }

  // All other predicates delegate to factMatches on the subject fact
  const subject = subjectFact(delta, source, desired);
  if (subject === undefined) return false;
  return factMatches(predicate, subject.fact, subject.view);
}

// ---------------------------------------------------------------------------
// Policy flattening + validation
// ---------------------------------------------------------------------------

/**
 * Flatten a policy with cycle detection.
 * Own rules appear before parent rules (own-before-extends order).
 */
export function flattenPolicy(policy: Policy): {
  id: string;
  filter: FilterRule[];
  serialize: SerializeRule[];
  assumedRoles: string[];
  assumedSchemas: string[];
  assumedPublications: string[];
  baseline?: string;
  defaultOwner?: string;
} {
  const visited = new Set<string>();
  return flattenInner(policy, visited);
}

function flattenInner(
  policy: Policy,
  visited: Set<string>,
): {
  id: string;
  filter: FilterRule[];
  serialize: SerializeRule[];
  assumedRoles: string[];
  assumedSchemas: string[];
  assumedPublications: string[];
  baseline?: string;
  defaultOwner?: string;
} {
  if (visited.has(policy.id)) {
    throw new Error(
      `Policy cycle detected: policy "${policy.id}" extends itself (cycle)`,
    );
  }
  visited.add(policy.id);

  const ownFilter: FilterRule[] = policy.filter ?? [];
  const ownSerialize: SerializeRule[] = policy.serialize ?? [];
  const ownAssumedRoles: string[] = policy.assumedRoles ?? [];
  const ownAssumedSchemas: string[] = policy.assumedSchemas ?? [];
  const ownAssumedPublications: string[] = policy.assumedPublications ?? [];
  const parentFilter: FilterRule[] = [];
  const parentSerialize: SerializeRule[] = [];
  const parentAssumedRoles: string[] = [];
  const parentAssumedSchemas: string[] = [];
  const parentAssumedPublications: string[] = [];
  // defaultOwner is scalar: own value wins, else the first parent that declares
  // one (own-before-extends, matching the rule-ordering convention).
  let parentDefaultOwner: string | undefined;

  if (policy.extends) {
    for (const parent of policy.extends) {
      // Each parent needs its own visited-set branch to allow diamond
      // inheritance between siblings while still catching cycles through
      // recursive extends chains.
      const branch = new Set(visited);
      const flat = flattenInner(parent, branch);
      parentFilter.push(...flat.filter);
      parentSerialize.push(...flat.serialize);
      parentAssumedRoles.push(...flat.assumedRoles);
      parentAssumedSchemas.push(...flat.assumedSchemas);
      parentAssumedPublications.push(...flat.assumedPublications);
      if (parentDefaultOwner === undefined && flat.defaultOwner !== undefined) {
        parentDefaultOwner = flat.defaultOwner;
      }
    }
  }

  visited.delete(policy.id);

  const result: {
    id: string;
    filter: FilterRule[];
    serialize: SerializeRule[];
    assumedRoles: string[];
    assumedSchemas: string[];
    assumedPublications: string[];
    baseline?: string;
    defaultOwner?: string;
  } = {
    id: policy.id,
    filter: [...ownFilter, ...parentFilter],
    serialize: [...ownSerialize, ...parentSerialize],
    // own ∪ parent, de-duplicated (membership test only — order irrelevant).
    assumedRoles: [...new Set([...ownAssumedRoles, ...parentAssumedRoles])],
    assumedSchemas: [
      ...new Set([...ownAssumedSchemas, ...parentAssumedSchemas]),
    ],
    assumedPublications: [
      ...new Set([...ownAssumedPublications, ...parentAssumedPublications]),
    ],
  };
  if (policy.baseline !== undefined) {
    result.baseline = policy.baseline;
  }
  const defaultOwner = policy.defaultOwner ?? parentDefaultOwner;
  if (defaultOwner !== undefined) {
    result.defaultOwner = defaultOwner;
  }
  return result;
}

/**
 * Validate a policy: throws on unknown serialize param names and extends
 * cycles.
 */
/**
 * Every field name that appears in some StableId variant (src/core/stable-id.ts).
 * `idField` reads `(fact.id as Record)[field]`, so a `field` not in this set is
 * a typo that would silently never match — validatePolicy rejects it (review
 * #7). Keep in sync with the StableId union.
 */
const KNOWN_ID_FIELDS = new Set<string>([
  "name",
  "schema",
  "table",
  "args",
  "role",
  "member",
  "server",
  "type",
  "publication",
  "grantee",
  "objtype",
  "provider",
  "target",
  // extensionIntent id fields (docs/architecture/extension-intent.md §3): let a
  // custom profile policy scope extension-intent facts (e.g. a pg_cron job) by
  // its stable-id parts.
  "ext",
  "intentKind",
  "key",
]);

/** Recursively reject any `idField` naming an unknown identity field. */
function validateIdFields(predicate: Predicate, policyId: string): void {
  if ("idField" in predicate) {
    if (!KNOWN_ID_FIELDS.has(predicate.idField.field)) {
      throw new Error(
        `Policy "${policyId}": idField references unknown identity field ` +
          `"${predicate.idField.field}". Known fields: ` +
          `${[...KNOWN_ID_FIELDS].sort().join(", ")}`,
      );
    }
  } else if ("all" in predicate) {
    for (const p of predicate.all) validateIdFields(p, policyId);
  } else if ("any" in predicate) {
    for (const p of predicate.any) validateIdFields(p, policyId);
  } else if ("not" in predicate) {
    validateIdFields(predicate.not, policyId);
  }
}

export function validatePolicy(policy: Policy): void {
  // Cycle detection via flatten (throws on cycles)
  const flat = flattenPolicy(policy);

  // Validate serialize param names
  for (const rule of flat.serialize) {
    for (const paramName of Object.keys(rule.params)) {
      if (!KNOWN_PARAMS.has(paramName)) {
        throw new Error(
          `Policy "${policy.id}": unknown serialize parameter "${paramName}". ` +
            `Known parameters: ${[...KNOWN_PARAMS].join(", ")}`,
        );
      }
    }
  }

  // Validate identity-field names in every filter + serialize predicate
  for (const rule of flat.filter) validateIdFields(rule.match, policy.id);
  for (const rule of flat.serialize) validateIdFields(rule.match, policy.id);
}

// ---------------------------------------------------------------------------
// Fact-level scope projection (the managed view)
// ---------------------------------------------------------------------------

/** True if the predicate references `verb` anywhere (an operation rule). */
function containsVerb(predicate: Predicate): boolean {
  if ("verb" in predicate) return true;
  if ("all" in predicate) return predicate.all.some(containsVerb);
  if ("any" in predicate) return predicate.any.some(containsVerb);
  if ("not" in predicate) return containsVerb(predicate.not);
  return false;
}

/**
 * Decide whether a fact is excluded from the view by the policy's SCOPE rules,
 * respecting first-match-wins and over-projection safety
 * (docs/architecture/managed-view-architecture.md move 3).
 *
 * Only pure-scope (no `verb`) rules can remove a fact wholesale. An operation
 * (`verb`) `include` earlier in the list protects a fact whose non-verb part it
 * matches — its deltas may be included, so we must keep the fact and let the
 * delta-level filter handle the rest. A `verb` `exclude` never removes a fact
 * wholesale (it bites a single verb), so it is skipped here. Erring toward
 * KEEP (under-projection) is safe: the existing delta-level filter still runs;
 * erring toward remove would silently drop managed objects.
 */
function factScopeExclusion(
  fact: Fact,
  rules: readonly FilterRule[],
  view: FactBase,
): FilterRule | undefined {
  for (const rule of rules) {
    if (containsVerb(rule.match)) {
      // operation rule: only an include that could match (with the verb free)
      // protects this fact; otherwise it cannot remove the fact wholesale.
      if (
        rule.action === "include" &&
        (factMatches(rule.match, fact, view, { verbAssumed: true }) ||
          factMatches(rule.match, fact, view))
      ) {
        return undefined;
      }
      continue;
    }
    if (factMatches(rule.match, fact, view)) {
      return rule.action === "exclude" ? rule : undefined;
    }
  }
  return undefined;
}

function stringValues(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

/** Whether a matcher names concrete objects rather than selecting a broad
 * class. This implements the pinned policy default; explicit rule metadata
 * always wins. Negation and any `*` keep the rule suspicious. */
function isNamedObjectPredicate(predicate: Predicate): boolean {
  if ("not" in predicate) return false;
  if ("all" in predicate) {
    return (
      predicate.all.some(isNamedObjectPredicate) &&
      !predicate.all.some(containsWildcardMatcher)
    );
  }
  if ("any" in predicate) {
    return (
      predicate.any.length > 0 &&
      predicate.any.every(isNamedObjectPredicate) &&
      !predicate.any.some(containsWildcardMatcher)
    );
  }
  if ("name" in predicate)
    return stringValues(predicate.name).every(noWildcard);
  if ("schema" in predicate)
    return stringValues(predicate.schema).every(noWildcard);
  if ("owner" in predicate)
    return stringValues(predicate.owner).every(noWildcard);
  if ("ownedByExtension" in predicate)
    return noWildcard(predicate.ownedByExtension);
  if ("idField" in predicate)
    return stringValues(predicate.idField.glob).every(noWildcard);
  if ("target" in predicate) {
    const selectors = [predicate.target.name, predicate.target.schema].filter(
      (value): value is string | string[] => value !== undefined,
    );
    return (
      selectors.length > 0 &&
      selectors.every((value) => stringValues(value).every(noWildcard))
    );
  }
  if ("partitionOf" in predicate) {
    const selectors = [
      predicate.partitionOf.name,
      predicate.partitionOf.schema,
    ].filter((value): value is string | string[] => value !== undefined);
    return (
      selectors.length > 0 &&
      selectors.every((value) => stringValues(value).every(noWildcard))
    );
  }
  return false;
}

function noWildcard(value: string): boolean {
  return !value.includes("*");
}

function containsWildcardMatcher(predicate: Predicate): boolean {
  if ("not" in predicate) return true;
  if ("all" in predicate) return predicate.all.some(containsWildcardMatcher);
  if ("any" in predicate) return predicate.any.some(containsWildcardMatcher);
  if ("name" in predicate)
    return stringValues(predicate.name).some((value) => !noWildcard(value));
  if ("schema" in predicate)
    return stringValues(predicate.schema).some((value) => !noWildcard(value));
  if ("owner" in predicate)
    return stringValues(predicate.owner).some((value) => !noWildcard(value));
  if ("ownedByExtension" in predicate)
    return !noWildcard(predicate.ownedByExtension);
  if ("idField" in predicate)
    return stringValues(predicate.idField.glob).some(
      (value) => !noWildcard(value),
    );
  if ("target" in predicate) {
    return [predicate.target.name, predicate.target.schema]
      .filter((value): value is string | string[] => value !== undefined)
      .some((value) => stringValues(value).some((part) => !noWildcard(part)));
  }
  if ("partitionOf" in predicate) {
    return [predicate.partitionOf.name, predicate.partitionOf.schema]
      .filter((value): value is string | string[] => value !== undefined)
      .some((value) => stringValues(value).some((part) => !noWildcard(part)));
  }
  return false;
}

function policyRuleAttribution(
  policyId: string,
  rule: FilterRule,
): ProjectionSuppressionAttribution {
  return {
    stage: "policyScopeRule",
    reasonCode:
      rule.audit?.reasonCode ??
      `policy:${policyId}:rule:${contentHash(rule.match as PayloadValue)}`,
    classification:
      rule.audit?.classification ??
      (isNamedObjectPredicate(rule.match) ? "acknowledged" : "suspicious"),
  };
}

/**
 * Resolve the managed VIEW that the engine diffs: extension members are kept
 * REFERENCE-ONLY (present so their satellite customizations diff, but the member
 * object is never a create/drop/alter action — CREATE EXTENSION manages it);
 * operationally-managed (`managedBy`) objects are hard-projected out; then the
 * policy's scope (non-`verb`) rules remove the facts they exclude — at the FACT
 * level, on both sides and the proof re-extract, so `plan == prove == run` holds
 * by construction. `verb` rules are left to the delta-level filter (filterDeltas).
 * With no policy and no provenance edges this is the identity projection, so the
 * corpus path is unchanged. This is the SINGLE projection point for the managed view.
 */
export function resolveView(
  fb: FactBase,
  policy: Policy | undefined,
  capability?: ApplierCapability,
  baseline?: FactBase,
  collectSuppression?: ProjectionSuppressionCollector,
): FactBase {
  // Identity fast path. With no policy, no capability and no baseline, every
  // stage below is already a no-op that hands `fb` back BY REFERENCE — but
  // establishing that costs three full `facts()` scans (member closure,
  // managedBy roots, scope-rule scan), which at catalog scale is the single
  // most expensive thing the planner does for zero effect. Prove it instead
  // from one pass over the edge list:
  //   - `extensionMemberClosure` seeds ONLY from `memberOfExtension` edges and
  //     `managedRoots` ONLY from `managedBy` edges, so with neither kind
  //     present both are empty (a `memberOfExtension`/`managedBy` edge is only
  //     ever in `fb.edges` with both endpoints present — the dangling carve-out
  //     is owner→role only — so scanning `edges` sees exactly what the
  //     per-fact `outgoingEdges` scans would);
  //   - `rules` is empty without a policy, and `factScopeExclusion` with no
  //     rules returns undefined for every fact, so `hardRoots`/`policyRefOnly`
  //     are empty;
  //   - `excludeFactsAndDescendants` returns `fb` unchanged for an empty root
  //     set, and the reference-only rebuild is skipped when both ref-only sets
  //     are empty.
  // No suppression is emitted on that path either (every collector block is
  // gated on a non-empty decision), so the fast path is observationally
  // identical INCLUDING for the projection audit.
  if (
    policy === undefined &&
    capability === undefined &&
    baseline === undefined &&
    !fb.edges.some(
      (edge) => edge.kind === "memberOfExtension" || edge.kind === "managedBy",
    )
  ) {
    return fb;
  }

  // Extension members become REFERENCE-ONLY, not pruned: the member OBJECT (and
  // its non-satellite descendants) is kept but never diffed, while its satellite
  // customizations (acl/comment/securityLabel) stay diffable. Computed on the RAW
  // input, BEFORE baseline subtraction — subtractBaseline prunes a member's
  // `memberOfExtension` edge when it removes the (baseline-identical) extension
  // endpoint, which would otherwise leave a surviving customized member looking
  // like a plain diffable object. Intersected with survivors below.
  const memberClosure = extensionMemberClosure(fb);
  const memberRefOnly = new Set(memberClosure.keys());
  // baseline subtraction (§3.9): facts present-and-identical in the platform
  // baseline drop out before anything else, so platform-managed objects are
  // invisible without a filter rule per object. Same fact-level projection as
  // extension-member / managed-object exclusion → the proof stays honest.
  let base = baseline ? subtractBaseline(fb, baseline) : fb;
  if (baseline !== undefined && collectSuppression !== undefined) {
    const attribution: ProjectionSuppressionAttribution = {
      stage: "baseline",
      reasonCode: "baseline.identical-state",
      classification: "acknowledged",
    };
    const roots = new Map<string, ProjectionSuppressionAttribution>();
    for (const fact of fb.facts()) {
      if (!base.has(fact.id)) roots.set(encodeId(fact.id), attribution);
    }
    collectRemovedSuppressions(fb, base, roots, collectSuppression);
  }
  // managed-object projection (P0): objects a stateful extension created
  // operationally (pg_partman children, pgmq queue tables) carry a `managedBy`
  // edge from a handler's snapshot-bound capture. They are HARD-projected out so
  // the default plan/prove/apply path never diffs them as drift (CLI-1555).
  // Unconditional: with bare extraction there are no `managedBy` edges, so this
  // is a no-op (corpus path unchanged).
  const managedRoots = new Set<string>();
  for (const fact of base.facts()) {
    if (base.outgoingEdges(fact.id).some((e) => e.kind === "managedBy")) {
      managedRoots.add(encodeId(fact.id));
    }
  }
  if (managedRoots.size > 0) {
    const before = base;
    base = excludeFactsAndDescendants(base, managedRoots);
    if (collectSuppression !== undefined) {
      const attribution: ProjectionSuppressionAttribution = {
        stage: "managedBy",
        reasonCode: "managed-by.provenance",
        classification: "acknowledged",
      };
      collectRemovedSuppressions(
        before,
        base,
        new Map([...managedRoots].map((key) => [key, attribution])),
        collectSuppression,
      );
    }
  }
  // capability restriction (move 6): project out facts whose action the applier
  // cannot execute. Additive; default unrestricted. FDW ACLs are superuser-only
  // GRANTs and a leaf fact, so they project out cleanly. (The owner residue is
  // NOT projected — it can't be skipped without an ACL ripple — it fail-fasts
  // in plan() instead; see capability.canSetOwner.)
  if (capability !== undefined) {
    const capRoots = capabilityExcludedRoots(base, capability);
    if (capRoots.size > 0) {
      const before = base;
      base = excludeFactsAndDescendants(base, capRoots);
      if (collectSuppression !== undefined) {
        const attribution: ProjectionSuppressionAttribution = {
          stage: "capability",
          reasonCode: "capability.fdw-acl",
          classification: "acknowledged",
        };
        collectRemovedSuppressions(
          before,
          base,
          new Map([...capRoots].map((key) => [key, attribution])),
          collectSuppression,
        );
      }
    }
  }

  // policy scope (non-`verb`) rules: hard-prune the facts they exclude, EXCEPT
  // an excluded fact whose schema is an assumedSchema (e.g. Supabase's `auth`)
  // or a publication named in assumedPublications (e.g. `supabase_realtime`),
  // which is kept REFERENCE-ONLY so a managed dependent (a user trigger on
  // `auth.users`, a `publicationRel` membership) resolves its parent while the
  // assumed object itself is never diffed. `verb` rules are left to the delta
  // filter.
  const flat = policy ? flattenPolicy(policy) : undefined;
  const rules = flat?.filter ?? [];
  const assumed = new Set(flat?.assumedSchemas ?? []);
  const assumedPubs = new Set(flat?.assumedPublications ?? []);
  const assumedSchemaOf = (id: StableId): string | undefined =>
    id.kind === "schema" ? getName(id) : getSchema(id);
  const isAssumed = (id: StableId): boolean => {
    if (id.kind === "publication") {
      const name = getName(id);
      return name !== undefined && assumedPubs.has(name);
    }
    const schema = assumedSchemaOf(id);
    return schema !== undefined && assumed.has(schema);
  };
  const hardRoots = new Set<string>();
  const policyRefOnly = new Set<string>();
  const policyRootAttribution = new Map<
    string,
    ProjectionSuppressionAttribution
  >();
  for (const fact of base.facts()) {
    const exclusion = factScopeExclusion(fact, rules, base);
    if (exclusion === undefined) continue;
    const attribution = policyRuleAttribution(
      flat?.id ?? policy?.id ?? "unknown",
      exclusion,
    );
    if (isAssumed(fact.id)) {
      policyRefOnly.add(encodeId(fact.id));
      policyRootAttribution.set(encodeId(fact.id), attribution);
    } else {
      hardRoots.add(encodeId(fact.id));
      policyRootAttribution.set(encodeId(fact.id), attribution);
    }
  }
  const pruned = excludeFactsAndDescendants(base, hardRoots);
  if (collectSuppression !== undefined && hardRoots.size > 0) {
    collectRemovedSuppressions(
      base,
      pruned,
      policyRootAttribution,
      collectSuppression,
    );
  }

  // Merge the reference-only sets (extension members + assumed-schema), keeping
  // only facts that actually survived pruning. This is the SINGLE projection
  // point for the managed view; `referenceOnly` is per-side deterministic (no
  // cross-side dependency → fingerprint/proof stay consistent).
  if (memberRefOnly.size === 0 && policyRefOnly.size === 0) return pruned;
  const surviving = new Set(pruned.facts().map((f) => encodeId(f.id)));
  const referenceOnly = new Set<string>();
  for (const key of memberRefOnly)
    if (surviving.has(key)) referenceOnly.add(key);
  for (const key of policyRefOnly)
    if (surviving.has(key)) referenceOnly.add(key);
  if (referenceOnly.size === 0) return pruned;
  if (collectSuppression !== undefined) {
    const recordReferenceOnly = (
      key: string,
      attribution: ProjectionSuppressionAttribution,
      viaDescendantOf?: StableId,
    ): void => {
      const fact = pruned.getByEncoded(key);
      if (fact === undefined) return;
      collectSuppression({
        subject: { kind: "fact", id: fact.id },
        ...attribution,
        ...(viaDescendantOf === undefined ? {} : { viaDescendantOf }),
      });
      for (const edge of pruned.outgoingEdges(fact.id)) {
        collectSuppression({
          subject: { kind: "edge", edge },
          ...attribution,
          ...(viaDescendantOf === undefined ? {} : { viaDescendantOf }),
        });
      }
    };
    for (const key of memberRefOnly) {
      if (!surviving.has(key)) continue;
      const member = pruned.getByEncoded(key);
      if (member === undefined) continue;
      let root = member.id;
      let cursor = member.parent;
      while (cursor !== undefined && memberClosure.has(encodeId(cursor))) {
        root = cursor;
        cursor = fb.get(cursor)?.parent;
      }
      recordReferenceOnly(
        key,
        {
          stage: "referenceOnly",
          reasonCode: "reference-only.extension-member",
          classification: "acknowledged",
        },
        encodeId(root) === key ? undefined : root,
      );
    }
    for (const key of policyRefOnly) {
      if (!surviving.has(key)) continue;
      const ruleAttribution = policyRootAttribution.get(
        key,
      ) as ProjectionSuppressionAttribution;
      const assumedKind =
        pruned.getByEncoded(key)?.id.kind === "publication"
          ? "assumed-publication"
          : "assumed-schema";
      recordReferenceOnly(key, {
        stage: "referenceOnly",
        reasonCode: `reference-only.${assumedKind}:${ruleAttribution.reasonCode}`,
        classification: ruleAttribution.classification,
      });
    }
  }
  // Rebuild to attach the reference-only marks. This runs whenever the view has
  // extension members / assumed-schema facts — including when `resolveView` is
  // re-invoked (via `plan()`) on an ALREADY scope-projected view (the export
  // path), which carries retained dangling owner→role edges. Propagate the
  // ownership carve-out so the rebuild does not silently re-prune them (a
  // public-only, extension-free view returns early above and never reaches here,
  // which is why the regression hid until an extension forced this rebuild).
  return buildFactBase(
    pruned.facts(),
    [...pruned.edges],
    pruned.source,
    referenceOnly,
    { allowDangling: retainOwnerRoleDangling },
  );
}

// ---------------------------------------------------------------------------
// Filter application
// ---------------------------------------------------------------------------

/**
 * Apply policy filter rules (first-match-wins) to a list of deltas.
 *
 * No rule matches → include. Filtered (excluded) deltas are returned in
 * `filtered` — never silently dropped. "Drift the user chose not to manage
 * is still drift they can ask about." (§3.9)
 */
export function filterDeltas(
  deltas: Delta[],
  policy: Policy,
  source: FactBase,
  desired: FactBase,
): { kept: Delta[]; filtered: Delta[] } {
  const flat = flattenPolicy(policy);
  const kept: Delta[] = [];
  const filtered: Delta[] = [];

  for (const delta of deltas) {
    let matched = false;
    let action: "exclude" | "include" = "include";
    for (const rule of flat.filter) {
      if (deltaMatches(rule.match, delta, source, desired)) {
        matched = true;
        action = rule.action;
        break;
      }
    }
    if (!matched || action === "include") {
      kept.push(delta);
    } else {
      filtered.push(delta);
    }
  }

  return { kept, filtered };
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { DependencyEdge, Fact, FactBase };
export type { Delta };
export type { FactKind, StableId };
export type { PlanParams };
