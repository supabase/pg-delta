import type { Action } from "../plan/plan.ts";
import {
  dataLossActions,
  type DataLossAction,
} from "../frontends/data-loss-actions.ts";
import { UsageError } from "./flags.ts";

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
