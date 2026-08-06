/**
 * ActionGraph building blocks — the graph construction, deterministic tie-break,
 * compaction passes, and safety report that the `finalizeActions` phase
 * (./phases/action-graph.ts) composes. They depend only on explicit inputs plus
 * module imports (encodeId, the rule table), never on planner-local state.
 *
 * `plan()` itself is now a thin orchestrator over four named phases
 * (./phases/{change-set,replacement-expansion,action-emitter,action-graph}.ts):
 * rename discovery and role-identity normalization, replacement expansion, and
 * the cohesive action-emission algorithm (with its producer/destroyer
 * bookkeeping, kept local to the ActionEmitter phase) each live behind a phase
 * boundary, so their invariants are testable in isolation.
 */
import type { FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { type ApplierCapability, canSetOwner } from "../policy/capability.ts";
import { extensionMemberClosure } from "../policy/view.ts";
import type { Action, SafetyReport } from "./plan.ts";
import { ruleFlag } from "./rule-flags.ts";
import { defaultRulesForId, type RulesForId } from "./rules.ts";
import { renderGrantSql } from "./rules/helpers.ts";
import { schemaCreateSql } from "./rules/schemas.ts";

/**
 * Build the action dependency graph (edges as `[fromIndex, toIndex]`) and check
 * requirements. Build order comes from the DESIRED state's edges, teardown
 * order from the SOURCE state's edges; a consumer of an id that neither this
 * plan produces nor the target already has is a missing requirement (it throws,
 * stage-5 deliverable 6). Reads only the emitted actions + the producer/
 * destroyer indexes + the two fact bases.
 */
export function buildActionGraph(
  actions: readonly Action[],
  producerOf: ReadonlyMap<string, number>,
  destroyerOf: ReadonlyMap<string, number>,
  source: FactBase,
  desired: FactBase,
  // actions that rename a subtree in place. A rename changes IDENTITY, not
  // ownership: PostgreSQL preserves the owner OID across `ALTER … RENAME`, and a
  // separate owner action handles any real change. So `owner` edges on a
  // renamed subtree must NOT drive ordering through the rename — otherwise a
  // table rename + owner-role rename deadlock each other (review P1 #2).
  renameActionIndices: ReadonlySet<number> = new Set(),
  // role names the active policy assumes exist at apply time but does not manage
  // (e.g. Supabase anon/authenticated). Treated like pg_*/PUBLIC by the
  // missing-requirement guard: a kept `GRANT … TO <role>` whose role object is
  // filtered out of the view is a valid grant target, not a stranded reference.
  assumedRoleNames: ReadonlySet<string> = new Set(),
  // schema names the active policy assumes exist at apply time but does not
  // manage (e.g. Supabase's `extensions`). Same idea as assumedRoleNames: a kept
  // `CREATE EXTENSION … SCHEMA <schema>` whose schema object is filtered out of
  // the view is a valid dependency target, not a stranded reference.
  assumedSchemaNames: ReadonlySet<string> = new Set(),
): Array<[number, number]> {
  const edges: Array<[number, number]> = [];

  // cache encoded -> StableId for ids we encounter
  const parseKeyCache = new Map<string, StableId>();
  const remember = (id: StableId): string => {
    const key = encodeId(id);
    parseKeyCache.set(key, id);
    return key;
  };

  // A reference target that is present-at-apply but kept out of the managed
  // view: built-in roles (pg_*/PUBLIC), policy-declared assumed roles, an
  // assumed SCHEMA object, or an object WITHIN an assumed schema (e.g. a
  // Supabase extension member in `extensions`). Such a target satisfies a
  // `consumes` / `depends` requirement without being produced by the plan.
  const isAmbient = (id: StableId): boolean => {
    if (id.kind === "role") {
      const name = (id as { name: string }).name;
      if (name.startsWith("pg_") || name === "PUBLIC") return true;
      if (assumedRoleNames.has(name)) return true;
    }
    if (
      id.kind === "schema" &&
      assumedSchemaNames.has((id as { name: string }).name)
    ) {
      return true;
    }
    const schema = (id as { schema?: string }).schema;
    if (schema === undefined || !assumedSchemaNames.has(schema)) return false;
    // An object in an assumed schema is ambient only when it is genuinely
    // external to the managed view (e.g. an extension member, hard-pruned from
    // both sides). If the DESIRED view KEEPS it (reference-only) yet it is absent
    // from the target (`!source.has`, checked by the caller), the desired side is
    // referencing something the target lacks — fail at plan time instead of
    // exempting it and letting apply fail against a missing relation (review P2).
    return !desired.has(id);
  };

  // Extension-member closures (member object OR non-satellite descendant →
  // owning extension ids), computed ONCE per side. A member is reference-only
  // (never produced/dropped by a standalone action) but is present-at-apply VIA
  // its extension, so it can satisfy a consume/depends requirement — but ONLY
  // when an owning extension is actually produced by this plan or already on the
  // target. A member whose CREATE EXTENSION a policy filtered away is NOT
  // present, so the guard must still fire (surfacing the missing reference at
  // plan time, not apply time). Distinct from the assumed-schema `isAmbient`
  // case, which never exempts a kept-but-absent object.
  const desiredMemberClosure = extensionMemberClosure(desired);
  const sourceMemberClosure = extensionMemberClosure(source);
  const memberExtensionPresent = (memberKey: string): boolean => {
    const exts =
      desiredMemberClosure.get(memberKey) ?? sourceMemberClosure.get(memberKey);
    return (
      exts !== undefined &&
      exts.some((ext) => producerOf.has(encodeId(ext)) || source.has(ext))
    );
  };

  // alter actions indexed by their primary fact (opts.consumes[0])
  const alterersOf = new Map<string, number[]>();
  actions.forEach((action, index) => {
    if (action.verb !== "alter") return;
    const primary = action.consumes[0];
    if (primary === undefined) return;
    const key = encodeId(primary);
    const list = alterersOf.get(key) ?? [];
    list.push(index);
    alterersOf.set(key, list);
  });

  actions.forEach((action, index) => {
    for (const id of action.releases) {
      const destroyer = destroyerOf.get(remember(id));
      if (destroyer !== undefined && destroyer !== index) {
        edges.push([index, destroyer]);
      }
    }
    for (const id of action.consumes) {
      const key = remember(id);
      const producer = producerOf.get(key);
      if (producer !== undefined && producer !== index)
        edges.push([producer, index]);
      const destroyer = destroyerOf.get(key);
      // consumer-before-destroyer applies only when the id is NOT being
      // re-produced; consumers of a replaced fact use the new one
      if (
        destroyer !== undefined &&
        destroyer !== index &&
        producer === undefined
      ) {
        edges.push([index, destroyer]);
      }
      // A consumed EXTENSION MEMBER is reference-only (its object is never a
      // create/drop action — CREATE/DROP EXTENSION materializes/removes it). A
      // customization on it (a GRANT/COMMENT/SECURITY LABEL, whose satellite fact
      // consumes the member as its parent) is sequenced relative to the
      // extension: AFTER `CREATE EXTENSION` (the member appears with it) and
      // BEFORE `DROP EXTENSION` (the member vanishes with it — REVOKE it while it
      // still exists).
      for (const ext of desiredMemberClosure.get(key) ?? []) {
        const extProducer = producerOf.get(encodeId(ext));
        if (extProducer !== undefined && extProducer !== index)
          edges.push([extProducer, index]);
      }
      for (const ext of sourceMemberClosure.get(key) ?? []) {
        const extDestroyer = destroyerOf.get(encodeId(ext));
        if (extDestroyer !== undefined && extDestroyer !== index)
          edges.push([index, extDestroyer]);
      }
      // the id must exist on the target before apply (source) or be
      // produced by this plan; "it's in the desired state" is not enough —
      // a policy filter can hide the delta that would have created it. Ambient
      // targets (built-in/assumed roles, assumed schemas, objects within them)
      // and extension members whose extension is actually present/produced
      // satisfy the requirement.
      if (
        producer === undefined &&
        !source.has(id) &&
        !isAmbient(id) &&
        !memberExtensionPresent(key)
      ) {
        throw new Error(
          `missing requirement: action "${action.sql}" consumes ${key}, which neither exists on the target nor is produced by this plan${desired.has(id) ? " — a filter may be hiding its creation" : ""}`,
        );
      }
    }
    // build order from the DESIRED state's dependency edges
    const producesKeys = new Set(action.produces.map((id) => encodeId(id)));
    for (const id of action.produces) {
      remember(id);
      if (!desired.has(id)) continue;
      for (const edge of desired.outgoingEdges(id)) {
        // a rename does not CREATE the owner edge (PG carries the owner across
        // RENAME); ordering the new owner's producer before the rename would,
        // paired with the source-side teardown edge below, form a cycle (P1 #2)
        if (edge.kind === "owner" && renameActionIndices.has(index)) continue;
        const targetKey = remember(edge.to);
        const producer = producerOf.get(targetKey);
        if (producer !== undefined && producer !== index) {
          edges.push([producer, index]);
        } else if (producer === undefined) {
          // the dependency is kept but altered in place: create the dependent
          // against its FINAL state (e.g. a view recreated after an enum's
          // value-set migration). Skip alterers that consume what this action
          // produces — there the alter needs the create first (REPLICA
          // IDENTITY USING a new index).
          for (const alterer of alterersOf.get(targetKey) ?? []) {
            if (alterer === index) continue;
            const altererConsumesProduct = (
              actions[alterer] as Action
            ).consumes.some((c) => producesKeys.has(encodeId(c)));
            if (!altererConsumesProduct) edges.push([alterer, index]);
          }
          // A produced fact's DEPENDS edge must resolve to something this plan
          // produces or the target already has — "it's in the desired view" is
          // NOT enough: a policy filter can hide the delta that would create the
          // dependency, leaving a CREATE that references a missing object (P0-1).
          // (An altered-in-place dependency is in `source`, so this never fires
          // for it; built-in endpoints resolve to no edge at all.)
          if (
            edge.kind === "depends" &&
            !source.has(edge.to) &&
            !isAmbient(edge.to) &&
            !memberExtensionPresent(targetKey)
          ) {
            throw new Error(
              `missing requirement: action "${action.sql}" produces ${encodeId(id)}, ` +
                `which depends on ${targetKey} — neither produced by this plan nor ` +
                `present on the target${desired.has(edge.to) ? " (a filter may be hiding its creation)" : ""}`,
            );
          }
        }
      }
    }
    // teardown order from the SOURCE state's dependency edges
    const destroysKeys = new Set(action.destroys.map((id) => encodeId(id)));
    for (const id of action.destroys) {
      const key = remember(id);
      // replace: destroy before re-produce. This applies even to ids with no
      // source fact — DROP IDENTITY implicitly destroys the backing sequence
      // (alsoDestroys), which a CREATE SEQUENCE of the same name re-produces
      const reproducer = producerOf.get(key);
      if (reproducer !== undefined && reproducer !== index)
        edges.push([index, reproducer]);
      if (!source.has(id)) continue;
      for (const edge of source.edges) {
        if (encodeId(edge.to) !== key) continue;
        // symmetric to the produces side: a rename does not TEAR DOWN the owner
        // edge, so an owner edge into the renamed subtree must not order the
        // owner's dependent teardown before the rename (P1 #2 cycle)
        if (edge.kind === "owner" && renameActionIndices.has(index)) continue;
        const dependentKey = remember(edge.from);
        const dependentDestroyer = destroyerOf.get(dependentKey);
        if (dependentDestroyer !== undefined && dependentDestroyer !== index) {
          edges.push([dependentDestroyer, index]);
        } else if (dependentDestroyer === undefined && desired.has(edge.from)) {
          if (producerOf.has(key)) continue;
          // the desired state no longer carries this dependency: whatever
          // alters the dependent (e.g. ALTER PUBLICATION … SET delisting a
          // dropped table) releases it — order those alters first
          const stillRequired = desired
            .outgoingEdges(edge.from)
            .some((e) => encodeId(e.to) === key);
          if (!stillRequired) {
            for (const alterer of alterersOf.get(dependentKey) ?? []) {
              if (alterer !== index) edges.push([alterer, index]);
            }
            continue;
          }
          // a surviving fact depends on something this plan destroys, and
          // nothing recreates the dependency: fail loudly (stage-5 deliverable 6)
          throw new Error(
            `missing requirement: ${dependentKey} survives but depends on ${key}, which this plan drops without recreating`,
          );
        }
      }
      // a dependent's teardown precedes in-place alters of its dependencies
      // (drop the view before migrating the enum its definition references);
      // an alterer that releases something this action destroys is the
      // opposite shape — releases ordering wins there
      for (const edge of source.outgoingEdges(id)) {
        const depKey = remember(edge.to);
        if (destroyerOf.has(depKey)) continue;
        for (const alterer of alterersOf.get(depKey) ?? []) {
          if (alterer === index) continue;
          const altererReleasesOurDestroy = (
            actions[alterer] as Action
          ).releases.some((r) => destroysKeys.has(encodeId(r)));
          if (!altererReleasesOurDestroy) edges.push([index, alterer]);
        }
      }
      // child teardown precedes parent teardown
      const fact = source.get(id);
      if (fact?.parent !== undefined) {
        const parentDestroyer = destroyerOf.get(remember(fact.parent));
        if (parentDestroyer !== undefined && parentDestroyer !== index) {
          edges.push([index, parentDestroyer]);
        }
      }
    }
  });

  return edges;
}

/**
 * Deterministic tie-break key for an action at index `i`: drops first
 * (descending kind weight), then creates/alters (ascending weight), then by
 * subject id, then by emission index (zero-padded so "10" sorts after "9" —
 * multi-spec sequences like the enum value-set migration rely on it).
 */
export function actionTieKey(
  actions: readonly Action[],
  i: number,
  // id-keyed resolver so an `extensionIntent` action ties on its DECLARED late
  // weight (via the profile's intent rules) rather than the accidental 99
  // catch-fallback. Defaults to the no-intent resolver for direct callers/tests.
  rulesForId: RulesForId = defaultRulesForId,
  // Optional per-action override for the SUBJECT segment of the key. The
  // ordering phase uses it to sort a table's ADD COLUMN creates by declared
  // column position (pg_attribute.attnum) instead of column NAME, so from-empty
  // CREATEs (and the folds that collapse them into the CREATE parens) render
  // columns in declared order. Returns undefined to fall back to the encoded
  // subject id (every other action is unaffected).
  subjectKeyOf?: (subject: StableId, action: Action) => string | undefined,
): string {
  const action = actions[i] as Action;
  const subject =
    action.produces[0] ?? action.destroys[0] ?? action.consumes[0];
  const weight = (() => {
    if (subject === undefined) return 99;
    try {
      return rulesForId(subject).weight;
    } catch {
      return 99;
    }
  })();
  const phase = action.verb === "drop" ? "0" : "1";
  const w = action.verb === "drop" ? 99 - weight : weight;
  const subjectKey =
    (subject !== undefined ? subjectKeyOf?.(subject, action) : undefined) ??
    (subject ? encodeId(subject) : "");
  return `${phase}|${String(w).padStart(2, "0")}|${subjectKey}|${String(i).padStart(6, "0")}`;
}

/**
 * Compaction (§3.6): fold `ADD COLUMN` clauses into their bare `CREATE TABLE`.
 * Safe iff every graph predecessor of the folded action sits at or before the
 * target — i.e. no edge crosses the merge. Purely cosmetic: produces/consumes
 * merge, so ordering semantics and the proof are unchanged. Mutates the target
 * actions in place (as the inline version did) and returns the kept actions.
 */
export function compactColumnFolds(
  orderedActions: readonly Action[],
  order: readonly number[],
  edges: ReadonlyArray<[number, number]>,
  foldHints: ReadonlyArray<{ foldInto: StableId; clause: string } | undefined>,
  acceptsFolds: readonly boolean[],
  positionOf: readonly number[],
  foldConstraints?: { exclude?: ReadonlySet<string> },
): Action[] {
  const predecessorsOf = new Map<number, number[]>();
  for (const [a, b] of edges) {
    const list = predecessorsOf.get(b) ?? [];
    list.push(a);
    predecessorsOf.set(b, list);
  }
  const targetPosOf = new Map<string, number>();
  orderedActions.forEach((action, pos) => {
    for (const id of action.produces) {
      const key = encodeId(id);
      if (!targetPosOf.has(key)) targetPosOf.set(key, pos);
    }
  });
  const foldedPos = new Set<number>();
  const effectivePosOf = new Map<number, number>(); // orig idx -> post-fold pos
  for (let pos = 0; pos < orderedActions.length; pos++) {
    const origIndex = order[pos] as number;
    const hint = foldHints[origIndex];
    if (hint === undefined) continue;
    const action = orderedActions[pos] as Action;
    if (action.newSegmentBefore || action.transactionality !== "transactional")
      continue;
    // Constraint fold hints (CONSTRAINT name <def> clauses) apply ONLY under
    // `foldConstraints` — the export-only mode whose output is loaded by the
    // retry/reorder loader. In a regular diff plan the apply EXECUTOR runs
    // actions in graph order, and folding an FK into a CREATE TABLE that
    // precedes the referenced table's CREATE would fail — so constraint hints
    // stay inert (data) unless the caller opted in. Cycle-participating FKs
    // (the caller's `exclude` set) stay as ALTERs so the raw file loader keeps
    // converging via the .fk.sql split.
    const isConstraintFold = action.produces[0]?.kind === "constraint";
    if (isConstraintFold) {
      if (foldConstraints === undefined) continue;
      if (foldConstraints.exclude?.has(encodeId(action.produces[0]!))) {
        continue;
      }
    }
    const targetPos = targetPosOf.get(encodeId(hint.foldInto));
    if (targetPos === undefined || targetPos >= pos) continue;
    const targetOrig = order[targetPos] as number;
    if (!acceptsFolds[targetOrig] || foldedPos.has(targetPos)) continue;
    const target = orderedActions[targetPos] as Action;
    if (target.verb !== "create" || target.newSegmentBefore) continue;
    // Column folds: ANY predecessor landing after the target vetoes the fold
    // (apply-executor safety — no edge may cross the merge).
    //
    // Constraint folds are loaded by the retry/reorder loader, not the apply
    // executor, so a crossing to another RELATION is tolerated: a VALIDATED FK's
    // referenced table (or a backing index / type on some other relation) may be
    // created by a LATER file and the loader reorders files to satisfy it. The
    // one crossing a constraint fold must NOT tolerate is a SAME-TABLE column of
    // its own fold target that was deferred to a later `ADD COLUMN` (its column
    // fold crossed a domain-type edge, or it is a generated column that never
    // hints) — folding the constraint inline would reference a column the CREATE
    // TABLE does not yet declare, and no file reordering can repair that. An
    // inlined column shares the target's effective position, so it never counts
    // as "after" and passes naturally.
    const foldTarget = hint.foldInto;
    const crossesEdge = (predecessorsOf.get(origIndex) ?? []).some((p) => {
      const pPos = effectivePosOf.get(p) ?? (positionOf[p] as number);
      if (pPos <= targetPos) return false;
      if (!isConstraintFold) return true;
      const predAction = orderedActions[positionOf[p] as number] as Action;
      return predAction.produces.some(
        (id) =>
          id.kind === "column" &&
          foldTarget.kind === "table" &&
          id.schema === foldTarget.schema &&
          id.table === foldTarget.name,
      );
    });
    if (crossesEdge) continue;
    // fold: splice the clause into the CREATE's column list
    target.sql = target.sql.endsWith("()")
      ? `${target.sql.slice(0, -2)}(${hint.clause})`
      : `${target.sql.slice(0, -1)}, ${hint.clause})`;
    target.produces.push(...action.produces);
    for (const id of action.consumes) {
      if (!target.consumes.some((c) => encodeId(c) === encodeId(id)))
        target.consumes.push(id);
    }
    if (action.dataLoss === "destructive") target.dataLoss = "destructive";
    target.rewriteRisk = target.rewriteRisk || action.rewriteRisk;
    foldedPos.add(pos);
    effectivePosOf.set(origIndex, targetPos);
  }
  return foldedPos.size > 0
    ? orderedActions.filter((_, pos) => !foldedPos.has(pos))
    : [...orderedActions];
}

/**
 * Compaction (§3.6), redundant-drop elision: a replace renders as drop + create,
 * but some kinds' create is self-resetting — `acl`'s `grantActions` leads with
 * its own `REVOKE ALL … FROM grantee`, byte-identical to the replace's drop. The
 * drop is then a redundant (idempotent) statement. This is GENERAL to every ACL
 * privilege change, so it is prettified here in the cosmetic pass rather than
 * special-cased per kind in the planner (correctness first, prettify later).
 *
 * Purely cosmetic + provably safe via LOCAL checks (no graph walk): remove a
 * `drop` D destroying a single id I when a `create` P re-produces I with the
 * SAME sql, and removing D cannot lose an ordering constraint —
 *   - D.consumes ⊆ P.consumes, so every producer that had to precede D also has
 *     to precede P (which remains);
 *   - nothing `releases` I (a releaser would order before D's destruction);
 *   - I has no children, so no child-teardown is ordered before D.
 * Those exhaust the edge kinds that can point INTO a drop, so P inherits all of
 * D's predecessors and the byte-identical statement reproduces D's effect.
 */
export function elideRedundantDrops(
  actions: readonly Action[],
  source: FactBase,
): Action[] {
  // first create that produces each id, with its sql + consume set
  const producerOf = new Map<
    string,
    { index: number; sql: string; consumes: Set<string> }
  >();
  actions.forEach((action, index) => {
    if (action.verb !== "create") return;
    for (const id of action.produces) {
      const key = encodeId(id);
      if (!producerOf.has(key)) {
        producerOf.set(key, {
          index,
          sql: action.sql,
          consumes: new Set(action.consumes.map(encodeId)),
        });
      }
    }
  });
  const releasedIds = new Set<string>();
  for (const action of actions)
    for (const id of action.releases) releasedIds.add(encodeId(id));

  const remove = new Set<number>();
  actions.forEach((action, index) => {
    if (action.verb !== "drop" || action.destroys.length !== 1) return;
    const id = action.destroys[0] as StableId;
    const key = encodeId(id);
    const producer = producerOf.get(key);
    if (producer === undefined || producer.index === index) return;
    if (producer.sql !== action.sql) return; // not a byte-identical reproduce
    if (releasedIds.has(key)) return; // a releaser is ordered before this drop
    if (source.childrenOf(id).length > 0) return; // child-teardown precedes it
    if (!action.consumes.every((c) => producer.consumes.has(encodeId(c))))
      return; // P would not inherit all of D's producer-predecessors
    remove.add(index);
  });

  return remove.size > 0
    ? actions.filter((_, index) => !remove.has(index))
    : [...actions];
}

/**
 * Compaction (§3.6): trim a redundant explicit DROP POLICY. The Bug-1 fix makes
 * policy drops never fold (suppressible:false), so an explicit DROP POLICY is
 * always emitted before the table drop. That is load-bearing when the policy
 * references a SEPARATELY-dropped object (a view in its USING subquery, a role):
 * PostgreSQL refuses to drop that object while the policy references it. But when
 * the policy only references its own table (or undropped objects), PostgreSQL's
 * implicit DROP TABLE cascade already removes the policy, so the explicit drop is
 * redundant.
 *
 * Cosmetic + safe via LOCAL checks: remove a `drop` of a single policy P on table
 * T when (a) some drop destroys T (DROP TABLE removes its policies by cascade),
 * and (b) P is not load-bearing — every object P depends on that is ALSO being
 * dropped lies within T's own drop subtree, so eliding P loses no ordering
 * another drop relies on. A wrong "keep" is merely verbose; a wrong "elide" would
 * surface as an unappliable plan in the corpus proof.
 */
export function elideCascadeSubsumedPolicyDrops(
  actions: readonly Action[],
  source: FactBase,
): Action[] {
  const droppedIds = new Set<string>();
  for (const action of actions)
    if (action.verb === "drop")
      for (const id of action.destroys) droppedIds.add(encodeId(id));

  const inSubtree = (x: StableId, rootKey: string): boolean => {
    let cur: StableId | undefined = x;
    while (cur !== undefined) {
      if (encodeId(cur) === rootKey) return true;
      cur = source.get(cur)?.parent;
    }
    return false;
  };

  const remove = new Set<number>();
  actions.forEach((action, index) => {
    if (action.verb !== "drop" || action.destroys.length !== 1) return;
    const id = action.destroys[0] as StableId;
    if (id.kind !== "policy") return;
    const table = source.get(id)?.parent;
    if (table === undefined) return;
    const tableKey = encodeId(table);
    if (!droppedIds.has(tableKey)) return; // table survives → the drop is real
    const loadBearing = source
      .outgoingEdges(id)
      .some(
        (e) => droppedIds.has(encodeId(e.to)) && !inSubtree(e.to, tableKey),
      );
    if (!loadBearing) remove.add(index);
  });

  return remove.size > 0
    ? actions.filter((_, index) => !remove.has(index))
    : [...actions];
}

/** The single privilege PostgreSQL grants to PUBLIC on a freshly-created object
 *  of each kind (Table 5.2, "Summary of Access Privileges"). Kinds absent here
 *  (table, view, sequence, schema, …) get NO PUBLIC default, so any PUBLIC grant
 *  on them is intentional and must be kept. Version-stable — unlike the owner's
 *  full default set (PG17 added MAINTAIN), so we never encode that. */
const PUBLIC_DEFAULT_PRIVILEGE: Partial<Record<StableId["kind"], string>> = {
  type: "USAGE",
  domain: "USAGE",
  language: "USAGE",
  function: "EXECUTE",
  procedure: "EXECUTE",
  aggregate: "EXECUTE",
};

/** Order-insensitive equality of two privilege lists (both arrive sorted from
 *  extraction, but compare as sets to stay robust to ordering). */
function samePrivilegeSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((priv) => set.has(priv));
}

/**
 * Whether an `ALTER DEFAULT PRIVILEGES` customizes the create-time default ACL
 * for this objtype, so a co-created object's ACL can no longer be assumed to be
 * the plain built-in default.
 *
 * The default-ACL elision drops an object's REVOKE/GRANT group only when the
 * group is a no-op against the create-time ACL. That holds for the built-in
 * default, but NOT when an ADP is in play: an ADP can reduce the default (e.g.
 * revoke the built-in PUBLIC `EXECUTE`, or revoke `UPDATE` from the owner), and
 * — critically — a plan that creates both the ADP and the object does NOT
 * guarantee the ADP runs first, so the object may be created with the built-in
 * default while the desired ACL is the reduced one (or vice versa). In every
 * such case the explicit REVOKE/GRANT group is load-bearing, so we keep it
 * (review P2). The redundant leading REVOKE is still trimmed by
 * elideCoCreateRevokeBeforeGrant.
 *
 * ADP is keyed by the CREATING role (`defaclrole`); when `capability` is known
 * we filter to the applier's role, else (corpus/raw) consider any role's ADP
 * (conservative — at worst we keep a redundant REVOKE/GRANT).
 */
function adpCustomizesObjtype(
  desired: FactBase,
  target: StableId,
  capability: ApplierCapability | undefined,
): boolean {
  const objtype = ruleFlag(target.kind, "defaclObjtype");
  if (objtype === undefined) return false; // kind has no default-ACL mechanism
  const targetSchema =
    target.kind === "schema"
      ? null
      : ((target as { schema?: string }).schema ?? null);
  return desired.facts().some((fact) => {
    if (fact.id.kind !== "defaultPrivilege") return false;
    const d = fact.id as Extract<StableId, { kind: "defaultPrivilege" }>;
    if (d.objtype !== objtype) return false;
    if (d.schema !== null && d.schema !== targetSchema) return false;
    if (capability !== undefined && d.role !== capability.role) return false;
    return true;
  });
}

/**
 * Compaction (§3.6), default-ACL elision: a freshly `CREATE`d object already
 * carries PostgreSQL's built-in default privileges, so the `acl` rule's
 * REVOKE-ALL+GRANT pair that merely re-materializes those defaults is a no-op on
 * a co-created target. `grantActions` emits them unconditionally (pg_dump's
 * model), which bloats every create. This prettifies that away — mirroring the
 * old engine's `filterPublicBuiltInDefaults` + owner-privilege filtering, but as
 * a late cosmetic pass so the diff/extract semantics are untouched.
 *
 * An `acl` create group is elidable iff its target object is itself created in
 * THIS plan AND the grant reproduces the grantee's EFFECTIVE create-time default
 * (the built-in default, OR what `ALTER DEFAULT PRIVILEGES` made it — see
 * effectiveDefaultPrivileges):
 *   - grantee is the target's owner — compared to `_ownerDefault` (the version-
 *     correct built-in owner set captured at extract);
 *   - grantee is PUBLIC — compared to the kind's built-in PUBLIC default.
 * In both cases an active ADP that reduced the default (e.g. revoked the PUBLIC
 * EXECUTE) makes the group load-bearing, so it is kept. Anything else (non-
 * default grant, third-party grantee, grant option, an ACL on a pre-existing
 * object) is kept verbatim.
 *
 * Safe + cosmetic via LOCAL checks: it only drops an `acl` group whose effect PG
 * guarantees on create, and the acl fact id is consumed by nothing outside its
 * own REVOKE/GRANT actions, so removing the whole group strands no consumer and
 * the proven end-state is unchanged. NEVER suppresses a REVOKE the desired state
 * needs (a revoked default is simply absent from the fact base — there is no acl
 * create action to elide, and this pass never adds or removes anything else).
 */
export function elideDefaultAclCreates(
  actions: readonly Action[],
  desired: FactBase,
  capability?: ApplierCapability,
): Action[] {
  // ids of the objects actually created in this plan (acl satellites excluded).
  const createdObjects = new Set<string>();
  for (const action of actions) {
    if (action.verb !== "create") continue;
    for (const id of action.produces) {
      if (id.kind !== "acl") createdObjects.add(encodeId(id));
    }
  }

  const elidable = new Set<string>();
  for (const action of actions) {
    if (action.verb !== "create") continue;
    const aclId = action.produces.find((id) => id.kind === "acl");
    if (aclId === undefined || aclId.kind !== "acl") continue;
    if (!createdObjects.has(encodeId(aclId.target))) continue;
    const fact = desired.get(aclId);
    if (fact === undefined) continue;
    const payload = fact.payload as {
      privileges?: string[];
      grantable?: string[];
      // non-semantic metadata (`_` prefix): the owner's create-time default
      // privilege set, captured at extract. Excluded from the hash/diff (hash.ts)
      // so it never causes cross-version/snapshot drift; read here only to decide
      // elision.
      _ownerDefault?: string[];
    };
    if ((payload.grantable ?? []).length > 0) continue; // grant option is never default
    const privileges = payload.privileges ?? [];

    // The group is a no-op (elidable) IFF the co-created object already grants
    // this grantee EXACTLY the desired privileges at CREATE time, i.e. the
    // desired ACL equals the BUILT-IN default. An ALTER DEFAULT PRIVILEGES
    // customizing this objtype breaks that assumption (the effective default
    // differs, and ADP-vs-CREATE order is not guaranteed in a from-empty plan),
    // so the explicit REVOKE/GRANT is load-bearing — keep it (review P2).
    if (adpCustomizesObjtype(desired, aclId.target, capability)) continue;

    if (aclId.grantee === "PUBLIC") {
      const def = PUBLIC_DEFAULT_PRIVILEGE[aclId.target.kind];
      if (def !== undefined && privileges.length === 1 && privileges[0] === def)
        elidable.add(encodeId(aclId));
      continue;
    }
    // owner grant: PostgreSQL grants the owner the full built-in default on a
    // fresh create. The set is version-dependent (PG17 added MAINTAIN), so we
    // compare against `_ownerDefault` — the owner's create-time set captured from
    // acldefault() at extract (non-semantic `_` metadata). A strict subset means
    // the owner revoked a default; eliding would leave the full default in place.
    const ownerEdge = desired
      .outgoingEdges(aclId.target)
      .find((e) => e.kind === "owner");
    if (
      ownerEdge !== undefined &&
      ownerEdge.to.kind === "role" &&
      ownerEdge.to.name === aclId.grantee &&
      payload._ownerDefault !== undefined &&
      samePrivilegeSet(privileges, payload._ownerDefault)
    )
      elidable.add(encodeId(aclId));
  }

  if (elidable.size === 0) return [...actions];
  // every action of an elidable group either produces the acl id (the REVOKE) or
  // consumes it (the GRANTs); nothing else touches the id, so this drops exactly
  // the group.
  return actions.filter(
    (action) =>
      !action.produces.some((id) => elidable.has(encodeId(id))) &&
      !action.consumes.some((id) => elidable.has(encodeId(id))),
  );
}

/**
 * Compaction (§3.6), co-create ownership fold: a freshly `CREATE`d object is
 * emitted applier-owned, followed by an `ALTER … OWNER TO <owner>` (move 6 —
 * create no longer sets the owner). Two cosmetic cleanups on that pair:
 *
 *  1. SCHEMA (always-on, syntactic): `CREATE SCHEMA s` + `ALTER SCHEMA s OWNER
 *     TO r` collapse into `CREATE SCHEMA s AUTHORIZATION r`. AUTHORIZATION is the
 *     canonical single-statement form even for a foreign owner and carries the
 *     IDENTICAL applier-capability requirement as the two-statement form, so the
 *     fold never changes whether apply succeeds — it runs regardless of
 *     capability.
 *  2. EVERY OTHER ownable kind (only when applier-known): drop the owner ALTER
 *     when the desired owner IS the applier (`capability.role`). On a
 *     creates-as-applier object that is a genuine no-op (already applier-owned on
 *     create). A foreign owner keeps its ALTER.
 *
 * Detected STRUCTURALLY (no SQL parsing — guardrail): the owner ALTER has
 * `verb === "alter"`, produces/destroys/releases nothing, consumes exactly the
 * created object id + one role id, the kind has an `ownerAlterPrefix` rule, and
 * the desired graph carries an `owner` edge object → role. `canSetOwner` already
 * fail-fasts at emit time, so every surviving owner ALTER here is one the applier
 * could run; Rule 2's "keep when owner ≠ applier" only fires for the
 * capability-undefined and superuser-applier cases.
 *
 * The fold also re-checks `canSetOwner` locally (when capability is known): both
 * the schema AUTHORIZATION form and the two-statement form carry the same
 * capability requirement, so an applier that cannot set the owner can run
 * NEITHER. Folding such a pair would be harmless against a converging plan (it
 * fails identically either way), but the local check keeps the pass
 * self-contained — correct even if a future caller runs it without the emit-time
 * fail-fast — instead of silently depending on that upstream guard.
 */
export function foldCoCreateOwnership(
  actions: readonly Action[],
  desired: FactBase,
  capability?: ApplierCapability,
): Action[] {
  // ids created in THIS plan (acl satellites excluded), with their create action.
  const createActionOf = new Map<string, Action>();
  for (const action of actions) {
    if (action.verb !== "create") continue;
    for (const id of action.produces)
      if (id.kind !== "acl") createActionOf.set(encodeId(id), action);
  }
  if (createActionOf.size === 0) return [...actions];

  const drop = new Set<number>();
  actions.forEach((action, index) => {
    if (action.verb !== "alter") return;
    if (action.produces.length > 0 || action.destroys.length > 0) return;
    if (action.releases.length > 0) return; // owner CHANGE, not a fresh-create set
    if (action.newSegmentBefore || action.transactionality !== "transactional")
      return;
    // structural owner-ALTER shape: exactly one object consume + one role consume
    const roleConsumes = action.consumes.filter((id) => id.kind === "role");
    const objConsumes = action.consumes.filter((id) => id.kind !== "role");
    if (roleConsumes.length !== 1 || objConsumes.length !== 1) return;
    const objId = objConsumes[0] as StableId;
    const owner = roleConsumes[0] as { kind: "role"; name: string };
    const createAction = createActionOf.get(encodeId(objId));
    if (createAction === undefined) return; // not co-created → real owner change
    if (ruleFlag(objId.kind, "ownerAlterPrefix") === undefined) return;
    const hasOwnerEdge = desired
      .outgoingEdges(objId)
      .some(
        (e) =>
          e.kind === "owner" &&
          e.to.kind === "role" &&
          e.to.name === owner.name,
      );
    if (!hasOwnerEdge) return;
    // local appliability check (#2): never collapse an owner ALTER the known
    // applier could not execute. Capability-undefined keeps the unrestricted
    // (superuser/CI) behavior — fold regardless.
    if (capability !== undefined && !canSetOwner(capability, owner.name))
      return;

    if (objId.kind === "schema") {
      // Rule 1 — syntactic fold into CREATE SCHEMA … AUTHORIZATION. Compare the
      // create against the canonical bare render; only fold the exact shape.
      if (
        createAction.newSegmentBefore ||
        createAction.transactionality !== "transactional"
      )
        return;
      const schemaName = (objId as { kind: "schema"; name: string }).name;
      if (createAction.sql !== schemaCreateSql(schemaName)) return;
      createAction.sql = schemaCreateSql(schemaName, owner.name);
      if (!createAction.consumes.some((c) => encodeId(c) === encodeId(owner)))
        createAction.consumes.push(owner);
      drop.add(index);
      return;
    }

    // Rule 2 — no-op elision only when the applier IS the owner.
    if (capability !== undefined && capability.role === owner.name)
      drop.add(index);
  });

  return drop.size > 0
    ? actions.filter((_, index) => !drop.has(index))
    : [...actions];
}

/**
 * Compaction (§3.6), co-create REVOKE elision: `grantActions` emits ACL via
 * pg_dump's REVOKE-first model (`REVOKE ALL … FROM g` then `GRANT … TO g`). On a
 * freshly co-created object whose grantee has no conflicting create-time default
 * privilege, the leading `REVOKE ALL` is cosmetic — the object starts with no
 * third-party grants, so the GRANT alone converges. This drops that REVOKE while
 * keeping every GRANT.
 *
 * Distinct from `elideDefaultAclCreates` (which drops WHOLE owner/PUBLIC default
 * groups): this runs AFTER it and only trims the REVOKE off the REMAINING
 * third-party groups, keeping the load-bearing GRANT.
 *
 * Guarded — keep the REVOKE when it is load-bearing:
 *  - target not co-created, or the group has no GRANT → untouched;
 *  - REVOKE-only group (empty privileges) → untouched (a revoked default);
 *  - explicit acl carries a grant option → untouched (REVOKE also clears those);
 *  - a potentially-active `defaultPrivilege` in desired would grant this grantee
 *    a privilege or grant option NOT in the explicit acl → untouched (strict-
 *    superset guard). With known capability "potentially active" means
 *    `default.role === capability.role` (creates-as-applier); without capability,
 *    any matching default (objtype + schema scope + grantee) is treated active.
 */
export function elideCoCreateRevokeBeforeGrant(
  actions: readonly Action[],
  desired: FactBase,
  capability?: ApplierCapability,
): Action[] {
  const createdObjects = new Set<string>();
  for (const action of actions) {
    if (action.verb !== "create") continue;
    for (const id of action.produces)
      if (id.kind !== "acl") createdObjects.add(encodeId(id));
  }
  if (createdObjects.size === 0) return [...actions];

  // index default-privilege facts once (small set) for the superset guard.
  const defaults = desired
    .facts()
    .filter((f) => f.id.kind === "defaultPrivilege");

  const defaultGrantsOutside = (
    target: StableId,
    grantee: string,
    explicit: Set<string>,
  ): boolean => {
    // which pg_default_acl objtype this kind maps to is declared per-kind in the
    // rule table (`defaclObjtype`, shared with the emitter's hygiene pass);
    // absent → no default ACLs, so no default can ever fire on it.
    const objtype = ruleFlag(target.kind, "defaclObjtype");
    if (objtype === undefined) return false; // kind has no default mechanism
    const targetSchema =
      target.kind === "schema"
        ? null
        : ((target as { schema?: string }).schema ?? null);
    for (const fact of defaults) {
      const d = fact.id as Extract<StableId, { kind: "defaultPrivilege" }>;
      if (d.objtype !== objtype || d.grantee !== grantee) continue;
      if (d.schema !== null && d.schema !== targetSchema) continue;
      if (capability !== undefined && d.role !== capability.role) continue;
      const payload = fact.payload as {
        privileges?: string[];
        grantable?: string[];
      };
      if ((payload.grantable ?? []).length > 0) return true; // grant option
      for (const priv of payload.privileges ?? [])
        if (!explicit.has(priv)) return true; // extra privilege
    }
    return false;
  };

  // index, once, the acl ids that a GRANT consumes. The REVOKE leader PRODUCES
  // the acl id (and consumes only its target), while every GRANT CONSUMES it
  // (emitCreate spec index > 0), so any acl id appearing in a `consumes` belongs
  // to a GRANT. Keeps the "group still has a GRANT" test O(1) per acl group.
  const aclIdsWithGrant = new Set<string>();
  for (const action of actions)
    for (const id of action.consumes)
      if (id.kind === "acl") aclIdsWithGrant.add(encodeId(id));

  const dropRevoke = new Set<number>();
  actions.forEach((action, index) => {
    if (action.verb !== "create") return;
    const aclId = action.produces.find((id) => id.kind === "acl");
    if (aclId === undefined || aclId.kind !== "acl") return; // not a REVOKE leader
    if (!createdObjects.has(encodeId(aclId.target))) return; // not co-created
    const fact = desired.get(aclId);
    if (fact === undefined) return;
    const payload = fact.payload as {
      privileges?: string[];
      grantable?: string[];
    };
    const privileges = payload.privileges ?? [];
    if (privileges.length === 0) return; // REVOKE-only group
    if ((payload.grantable ?? []).length > 0) return; // explicit grant option
    const aclKey = encodeId(aclId);
    if (!aclIdsWithGrant.has(aclKey)) return; // no GRANT → REVOKE is the whole effect
    // the OWNER starts with the full create-time default, so its leading
    // REVOKE is load-bearing whenever the owner's grant is a strict subset —
    // and that is the ONLY owner case reaching here, because a full-default
    // owner group was already dropped wholesale by elideDefaultAclCreates.
    // Stripping it would leave PostgreSQL's full default in place (review P2).
    const ownerEdge = desired
      .outgoingEdges(aclId.target)
      .find((e) => e.kind === "owner");
    if (
      ownerEdge !== undefined &&
      ownerEdge.to.kind === "role" &&
      ownerEdge.to.name === aclId.grantee
    )
      return;
    if (defaultGrantsOutside(aclId.target, aclId.grantee, new Set(privileges)))
      return; // REVOKE is load-bearing
    dropRevoke.add(index);
  });

  // the kept GRANTs still consume the now-unproduced acl ids; the downstream
  // mergeCoTargetGrants pass reads them (they carry privileges/column identity)
  // and performs the cosmetic strip as its final tidy step.
  return dropRevoke.size > 0
    ? actions.filter((_, index) => !dropRevoke.has(index))
    : [...actions];
}

/**
 * Compaction (§3.6), multi-grantee GRANT merge: `grantActions` emits one GRANT
 * per grantee (pg_dump's model). On a freshly co-created object the leading
 * REVOKEs are elided (elideCoCreateRevokeBeforeGrant, above), leaving the
 * same-target GRANTs CONSECUTIVE in the final order — the acl stable-id encodes
 * `(target).grantee`, so the deterministic tie-break already groups them. When
 * consecutive GRANTs differ only in grantee (same target, same privilege set,
 * no grant option, no column qualifier), merge them into the idiomatic
 * `GRANT … TO a, b, c` a human would write.
 *
 * Safe + cosmetic via LOCAL checks — consecutiveness is the ordering proof:
 * nothing sits between the merged members, so placing the merge at the first
 * member's position preserves every predecessor/successor constraint each
 * member had (and nothing in the graph ever consumes an acl id outside its own
 * REVOKE/GRANT group, so no third action can be forced between them). Guards:
 *  - only actions whose SQL equals the canonical single-grantee render
 *    (renderGrantSql) are candidates — never parse SQL, only re-render;
 *  - a group whose REVOKE leader survives (pre-existing target, grant-option
 *    or subset-default groups) is left intact, keeping the pg_dump pairing;
 *  - a `newSegmentBefore` boundary on a later member breaks the run
 *    (compaction never folds across a commit boundary);
 *  - privileges must match as a SET (extraction emits them sorted).
 *
 * Runs LAST in the compaction chain so it sees final adjacency. Its tail also
 * performs the cosmetic consumes-tidy relocated from
 * elideCoCreateRevokeBeforeGrant: acl ids no remaining action produces are
 * stripped from consumes (the graph is not re-consulted post-compaction, but
 * keep the artifact clean).
 */
type AclId = Extract<StableId, { kind: "acl" }>;
const isAclId = (id: StableId): id is AclId => id.kind === "acl";

export function mergeCoTargetGrants(
  actions: readonly Action[],
  desired: FactBase,
): Action[] {
  // acl ids still produced by a surviving REVOKE leader
  const producedAcl = new Set<string>();
  for (const action of actions) {
    if (action.verb !== "create") continue;
    for (const id of action.produces)
      if (isAclId(id)) producedAcl.add(encodeId(id));
  }

  interface Candidate {
    aclId: AclId;
    targetKey: string;
    privileges: string[];
  }
  const candidateOf = (action: Action): Candidate | undefined => {
    if (action.verb !== "create") return undefined;
    if (action.produces.length > 0 || action.destroys.length > 0) {
      return undefined;
    }
    if (action.releases.length > 0) return undefined;
    if (action.transactionality !== "transactional") return undefined;
    const aclIds = action.consumes.filter(isAclId);
    if (aclIds.length !== 1) return undefined;
    const aclId = aclIds[0] as AclId;
    if (aclId.column !== undefined) return undefined; // column grants stay verbatim
    if (producedAcl.has(encodeId(aclId))) return undefined; // REVOKE leader kept
    const fact = desired.get(aclId);
    if (fact === undefined) return undefined;
    const payload = fact.payload as {
      privileges?: string[];
      grantable?: string[];
    };
    if ((payload.grantable ?? []).length > 0) return undefined;
    const privileges = payload.privileges ?? [];
    if (privileges.length === 0) return undefined;
    // canonical-render guard: only the exact plain single-grantee GRANT merges
    if (action.sql !== renderGrantSql(aclId.target, privileges, [aclId.grantee]))
      return undefined;
    return { aclId, targetKey: encodeId(aclId.target), privileges };
  };

  const out: Action[] = [];
  let i = 0;
  while (i < actions.length) {
    const action = actions[i] as Action;
    const first = candidateOf(action);
    if (first === undefined) {
      out.push(action);
      i++;
      continue;
    }
    const run = [first];
    let j = i + 1;
    while (j < actions.length) {
      const nextAction = actions[j] as Action;
      if (nextAction.newSegmentBefore) break;
      const next = candidateOf(nextAction);
      if (next === undefined || next.targetKey !== first.targetKey) break;
      if (!samePrivilegeSet(next.privileges, first.privileges)) break;
      run.push(next);
      j++;
    }
    if (run.length === 1) {
      out.push(action);
      i++;
      continue;
    }
    // merge at the first member's position: sql re-rendered with the grantee
    // list, consumes = union (roles, target, acl ids) so the artifact's
    // dependency metadata still names every input.
    const consumes: StableId[] = [];
    const seen = new Set<string>();
    for (let k = i; k < j; k++) {
      for (const c of (actions[k] as Action).consumes) {
        const key = encodeId(c);
        if (seen.has(key)) continue;
        seen.add(key);
        consumes.push(c);
      }
    }
    out.push({
      ...action,
      sql: renderGrantSql(
        first.aclId.target,
        first.privileges,
        run.map((c) => c.aclId.grantee),
      ),
      consumes,
    });
    i = j;
  }

  // cosmetic tidy (relocated from elideCoCreateRevokeBeforeGrant): drop acl
  // ids nothing in the final list produces from consumes.
  const dangling = (c: StableId): boolean =>
    isAclId(c) && !producedAcl.has(encodeId(c));
  return out.map((action) => {
    if (!action.consumes.some(dangling)) return action;
    return {
      ...action,
      consumes: action.consumes.filter((c) => !dangling(c)),
    };
  });
}

/** Aggregate the per-action safety metadata (§3.7): destructive / rewrite /
 *  non-transactional counts and a histogram of documented lock classes. */
export function computeSafetyReport(actions: readonly Action[]): SafetyReport {
  const safetyReport: SafetyReport = {
    destructiveActions: actions.filter((a) => a.dataLoss === "destructive")
      .length,
    rewriteRiskActions: actions.filter((a) => a.rewriteRisk).length,
    nonTransactionalActions: actions.filter(
      (a) => a.transactionality === "nonTransactional",
    ).length,
    lockClasses: {},
  };
  for (const action of actions) {
    safetyReport.lockClasses[action.lockClass] =
      (safetyReport.lockClasses[action.lockClass] ?? 0) + 1;
  }
  return safetyReport;
}
