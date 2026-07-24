import type { Plan } from "../plan/plan.ts";

export interface ApplyTimeoutOptions {
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}

/** Build the session settings sent before each apply segment. */
export function buildApplyPreamble(
  plan: Pick<Plan, "preamble">,
  options: ApplyTimeoutOptions | undefined,
  local: boolean,
): string[] {
  const scope = local ? "LOCAL " : "";
  return [
    ...(options?.lockTimeoutMs !== undefined
      ? [`SET ${scope}lock_timeout = ${options.lockTimeoutMs}`]
      : []),
    ...(options?.statementTimeoutMs !== undefined
      ? [`SET ${scope}statement_timeout = ${options.statementTimeoutMs}`]
      : []),
    ...plan.preamble.map(
      (setting) => `SET ${scope}${setting.name} = ${setting.value}`,
    ),
  ];
}
