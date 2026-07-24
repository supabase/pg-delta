import { encodeId, type StableId } from "../core/stable-id.ts";
import type { Action } from "./plan.ts";

type PersistedRelationId = {
  kind: "table" | "materializedView";
  schema: string;
  name: string;
};

export interface DestructionMetadataViolation {
  actionIndex: number;
  relation: PersistedRelationId;
}

function persistedRelation(id: StableId): id is StableId & PersistedRelationId {
  return id.kind === "table" || id.kind === "materializedView";
}

/** Find contradictions between executable persisted-relation destruction and
 * the action's data-loss declaration. An accepted rename is exempt only when
 * the same action preserves the same relation kind under the accepted new ID. */
export function findDestructionMetadataViolations(
  actions: readonly Action[],
  acceptedRenames: ReadonlyArray<{ from: StableId; to: StableId }> = [],
): DestructionMetadataViolation[] {
  const accepted = new Map<string, PersistedRelationId>();
  for (const rename of acceptedRenames) {
    if (
      persistedRelation(rename.from) &&
      persistedRelation(rename.to) &&
      rename.from.kind === rename.to.kind
    ) {
      accepted.set(encodeId(rename.from), rename.to);
    }
  }

  const violations: DestructionMetadataViolation[] = [];
  actions.forEach((action, actionIndex) => {
    if (action.dataLoss === "destructive") return;
    for (const destroyed of action.destroys) {
      if (!persistedRelation(destroyed)) continue;
      const renamedTo = accepted.get(encodeId(destroyed));
      if (
        renamedTo !== undefined &&
        action.produces.some(
          (produced) =>
            persistedRelation(produced) &&
            produced.kind === destroyed.kind &&
            encodeId(produced) === encodeId(renamedTo),
        )
      ) {
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
    `${operation}: action[${first.actionIndex}] destroys persisted relation ${encodeId(first.relation)} but declares dataLoss:none`,
  );
}
