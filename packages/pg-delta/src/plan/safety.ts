import { encodeId, type StableId } from "../core/stable-id.ts";
import type { Action } from "./plan.ts";

type IntrinsicallyDataBearingId =
  | {
      kind: "table" | "materializedView";
      schema: string;
      name: string;
    }
  | {
      kind: "column";
      schema: string;
      table: string;
      name: string;
    }
  | {
      kind: "typeAttribute";
      schema: string;
      type: string;
      name: string;
    };

export interface DestructionMetadataViolation {
  actionIndex: number;
  relation: IntrinsicallyDataBearingId;
}

export interface DerivedAcceptedRename {
  actionIndex: number;
  from: StableId;
  to: StableId;
}

function intrinsicallyDataBearing(
  id: StableId,
): id is IntrinsicallyDataBearingId {
  return (
    id.kind === "table" ||
    id.kind === "materializedView" ||
    id.kind === "column" ||
    id.kind === "typeAttribute"
  );
}

const RELATION_KINDS = new Set<StableId["kind"]>([
  "table",
  "view",
  "materializedView",
  "foreignTable",
]);

type RelationId = {
  kind: "table" | "view" | "materializedView" | "foreignTable";
  schema: string;
  name: string;
};

function isRelationId(id: StableId): id is RelationId {
  return RELATION_KINDS.has(id.kind);
}

/** Project one structured ID through an accepted root rename. Rename actions
 * destroy/produce the whole structural subtree, while Plan.acceptedRenames
 * deliberately stamps only the accepted root pair. */
function projectThroughAcceptedRename(
  id: StableId,
  rename: { from: StableId; to: StableId },
): StableId | undefined {
  const { from, to } = rename;
  if (from.kind !== to.kind) return undefined;

  if (encodeId(id) === encodeId(from)) {
    return to;
  }

  if (id.kind === "comment") {
    const target = projectThroughAcceptedRename(id.target, rename);
    return target === undefined ? undefined : { ...id, target };
  }
  if (id.kind === "acl") {
    const target = projectThroughAcceptedRename(id.target, rename);
    return target === undefined ? undefined : { ...id, target };
  }
  if (id.kind === "securityLabel") {
    const target = projectThroughAcceptedRename(id.target, rename);
    return target === undefined ? undefined : { ...id, target };
  }

  if (from.kind === "schema" && to.kind === "schema") {
    if (!("schema" in id) || id.schema !== from.name) return undefined;
    return { ...id, schema: to.name } as StableId;
  }

  if (
    isRelationId(from) &&
    isRelationId(to) &&
    "schema" in id &&
    "table" in id
  ) {
    if (id.schema !== from.schema || id.table !== from.name) return undefined;
    return { ...id, schema: to.schema, table: to.name } as StableId;
  }

  if (
    from.kind === "type" &&
    to.kind === "type" &&
    id.kind === "typeAttribute"
  ) {
    if (id.schema !== from.schema || id.type !== from.name) return undefined;
    return { ...id, schema: to.schema, type: to.name };
  }

  return undefined;
}

/** Expand stamped accepted roots into the exact old→new IDs carried by each
 * rename action. Both roots and each projected descendant must occur in that
 * same action, so callers cannot borrow a rename declaration from elsewhere. */
export function deriveAcceptedRenameMappings(
  actions: readonly Action[],
  acceptedRenames: ReadonlyArray<{ from: StableId; to: StableId }> = [],
): DerivedAcceptedRename[] {
  const mappings: DerivedAcceptedRename[] = [];
  const seen = new Set<string>();
  actions.forEach((action, actionIndex) => {
    const destroyed = new Set(action.destroys.map(encodeId));
    const produced = new Set(action.produces.map(encodeId));
    for (const rename of acceptedRenames) {
      if (
        !destroyed.has(encodeId(rename.from)) ||
        !produced.has(encodeId(rename.to))
      ) {
        continue;
      }
      for (const from of action.destroys) {
        const to = projectThroughAcceptedRename(from, rename);
        if (to === undefined || !produced.has(encodeId(to))) continue;
        const key = `${actionIndex}:${encodeId(from)}:${encodeId(to)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mappings.push({ actionIndex, from, to });
      }
    }
  });
  return mappings;
}

function destroyedWithOwningRoot(id: StableId, action: Action): boolean {
  if (id.kind === "column") {
    return action.destroys.some(
      (candidate) =>
        isRelationId(candidate) &&
        candidate.schema === id.schema &&
        candidate.name === id.table,
    );
  }
  if (id.kind === "typeAttribute") {
    return action.destroys.some(
      (candidate) =>
        candidate.kind === "type" &&
        candidate.schema === id.schema &&
        candidate.name === id.type,
    );
  }
  return false;
}

/** Find contradictions between executable, intrinsically data-bearing object
 * destruction and the action's data-loss declaration. An accepted rename is
 * exempt only when the same action preserves the same kind under the accepted
 * new ID. */
export function findDestructionMetadataViolations(
  actions: readonly Action[],
  acceptedRenames: ReadonlyArray<{ from: StableId; to: StableId }> = [],
): DestructionMetadataViolation[] {
  const violations: DestructionMetadataViolation[] = [];
  const acceptedMappings = deriveAcceptedRenameMappings(
    actions,
    acceptedRenames,
  );
  actions.forEach((action, actionIndex) => {
    if (action.dataLoss === "destructive") return;
    for (const destroyed of action.destroys) {
      if (!intrinsicallyDataBearing(destroyed)) continue;
      // Cascading parent DDL owns the child's safety classification. A table or
      // materialized-view parent is checked below as its own root; views,
      // foreign tables, and standalone composite types hold no local row data.
      if (destroyedWithOwningRoot(destroyed, action)) continue;
      const preservedByRename = acceptedMappings.some(
        (mapping) =>
          mapping.actionIndex === actionIndex &&
          mapping.from.kind === destroyed.kind &&
          encodeId(mapping.from) === encodeId(destroyed),
      );
      if (preservedByRename) {
        continue;
      }
      violations.push({ actionIndex, relation: destroyed });
    }
  });
  return violations;
}

export function assertDestructionMetadataIntegrity(
  actions: readonly Action[],
  acceptedRenames: ReadonlyArray<{ from: StableId; to: StableId }> = [],
  operation = "plan",
): void {
  const violations = findDestructionMetadataViolations(
    actions,
    acceptedRenames,
  );
  if (violations.length === 0) return;
  const first = violations[0]!;
  throw new Error(
    `${operation}: action[${first.actionIndex}] destroys intrinsically data-bearing object ${encodeId(first.relation)} but declares dataLoss:none`,
  );
}
