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

/** Find contradictions between executable, intrinsically data-bearing object
 * destruction and the action's data-loss declaration. An accepted rename is
 * exempt only when the same action preserves the same kind under the accepted
 * new ID. */
export function findDestructionMetadataViolations(
  actions: readonly Action[],
  acceptedRenames: ReadonlyArray<{ from: StableId; to: StableId }> = [],
): DestructionMetadataViolation[] {
  const accepted = new Map<string, IntrinsicallyDataBearingId>();
  for (const rename of acceptedRenames) {
    if (
      intrinsicallyDataBearing(rename.from) &&
      intrinsicallyDataBearing(rename.to) &&
      rename.from.kind === rename.to.kind
    ) {
      accepted.set(encodeId(rename.from), rename.to);
    }
  }

  const violations: DestructionMetadataViolation[] = [];
  actions.forEach((action, actionIndex) => {
    if (action.dataLoss === "destructive") return;
    for (const destroyed of action.destroys) {
      if (!intrinsicallyDataBearing(destroyed)) continue;
      const renamedTo = accepted.get(encodeId(destroyed));
      if (
        renamedTo !== undefined &&
        action.produces.some(
          (produced) =>
            intrinsicallyDataBearing(produced) &&
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
    `${operation}: action[${first.actionIndex}] destroys intrinsically data-bearing object ${encodeId(first.relation)} but declares dataLoss:none`,
  );
}
