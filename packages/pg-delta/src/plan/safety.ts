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

/** Project one data-bearing ID through an accepted root rename. Rename actions
 * destroy/produce the whole structural subtree, while Plan.acceptedRenames
 * deliberately stamps only the accepted root pair. Derive the descendant ID
 * change from structured identity fields, then let the caller require that the
 * projected ID is produced by this exact action. */
function projectThroughAcceptedRename(
  id: IntrinsicallyDataBearingId,
  rename: { from: StableId; to: StableId },
): IntrinsicallyDataBearingId | undefined {
  const { from, to } = rename;
  if (from.kind !== to.kind) return undefined;

  if (encodeId(id) === encodeId(from)) {
    return intrinsicallyDataBearing(to) ? to : undefined;
  }

  if (from.kind === "schema" && to.kind === "schema") {
    if (id.schema !== from.name) return undefined;
    return { ...id, schema: to.name };
  }

  if (from.kind === "table" && to.kind === "table" && id.kind === "column") {
    if (id.schema !== from.schema || id.table !== from.name) return undefined;
    return { ...id, schema: to.schema, table: to.name };
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

/** Find contradictions between executable, intrinsically data-bearing object
 * destruction and the action's data-loss declaration. An accepted rename is
 * exempt only when the same action preserves the same kind under the accepted
 * new ID. */
export function findDestructionMetadataViolations(
  actions: readonly Action[],
  acceptedRenames: ReadonlyArray<{ from: StableId; to: StableId }> = [],
): DestructionMetadataViolation[] {
  const violations: DestructionMetadataViolation[] = [];
  actions.forEach((action, actionIndex) => {
    if (action.dataLoss === "destructive") return;
    for (const destroyed of action.destroys) {
      if (!intrinsicallyDataBearing(destroyed)) continue;
      const preservedByRename = acceptedRenames.some((rename) => {
        const actionCarriesRename =
          action.destroys.some(
            (id) => encodeId(id) === encodeId(rename.from),
          ) &&
          action.produces.some((id) => encodeId(id) === encodeId(rename.to));
        if (!actionCarriesRename) return false;
        const renamedTo = projectThroughAcceptedRename(destroyed, rename);
        return (
          renamedTo !== undefined &&
          action.produces.some(
            (produced) =>
              intrinsicallyDataBearing(produced) &&
              produced.kind === destroyed.kind &&
              encodeId(produced) === encodeId(renamedTo),
          )
        );
      });
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
