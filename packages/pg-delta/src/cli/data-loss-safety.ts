import type { Action } from "../plan/plan.ts";
import { UsageError } from "./flags.ts";

interface DataLossAction {
  actionIndex: number;
  sql: string;
}

/** Derive the gate from executable actions, never a serialized summary count. */
export function dataLossActions(actions: readonly Action[]): DataLossAction[] {
  return actions.flatMap((action, actionIndex) => {
    if (action.dataLoss !== "none" && action.dataLoss !== "destructive") {
      throw new Error(
        `data-loss safety: action[${actionIndex}].dataLoss must be "none" or "destructive"`,
      );
    }
    return action.dataLoss === "destructive"
      ? [{ actionIndex, sql: action.sql }]
      : [];
  });
}

export function assertDataLossAllowed(
  actions: readonly Action[],
  allowDataLoss: boolean,
  operation: string,
): DataLossAction[] {
  const destructive = dataLossActions(actions);
  if (destructive.length === 0 || allowDataLoss) return destructive;
  const sample = destructive
    .slice(0, 3)
    .map(({ actionIndex, sql }) => `action[${actionIndex}] ${sql}`)
    .join("; ");
  const extra =
    destructive.length > 3 ? ` (+${destructive.length - 3} more)` : "";
  throw new UsageError(
    `${operation}: refusing ${destructive.length} data-destructive action(s) without --allow-data-loss: ${sample}${extra}`,
  );
}
