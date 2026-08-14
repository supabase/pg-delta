import type { Action } from "../plan/plan.ts";

export interface DataLossAction {
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
