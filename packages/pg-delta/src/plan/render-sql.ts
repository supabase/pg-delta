/**
 * Render a plan as a single replayable .sql script.
 *
 * The output mirrors what `apply()` (src/apply/apply.ts) executes: the plan's
 * `preamble` session settings emitted as leading `SET`s (so forward-referencing
 * function bodies elaborate — `check_function_bodies = off` is always present),
 * then every action's SQL in `plan.actions` order (the dependency-sorted replay
 * order), each terminated with a single semicolon.
 *
 * Unlike the executor, this produces a flat script with no transaction
 * framing — callers replay it as one multi-statement batch on a single
 * connection (`applySupabaseBaseInit`). That is correct for an all-transactional
 * baseline (schemas / tables / functions / grants / roles); a plan containing a
 * `nonTransactional` or `commitBoundaryAfter` action must not be rendered this
 * way (the batch would fail inside the implicit transaction block). The Supabase
 * baseline is all-transactional, and the pipeline's zero-diff replay gate would
 * surface any regression.
 */
import type { Plan } from "./plan.ts";

export type RenderablePlan = Pick<Plan, "preamble"> & {
  actions: ReadonlyArray<Pick<Plan["actions"][number], "sql">>;
};

export function renderPlanSql(plan: RenderablePlan): string {
  const parts: string[] = [];
  for (const setting of plan.preamble) {
    parts.push(`SET ${setting.name} = ${setting.value};`);
  }
  for (const action of plan.actions) {
    const sql = action.sql.trimEnd();
    parts.push(sql.endsWith(";") ? sql : `${sql};`);
  }
  // This script has no transaction framing, so its session-level SETs would
  // persist on the connection after the batch — and callers replay it on a
  // POOLED connection they hand back for reuse (schema-plan.ts seeds a shadow
  // then releases the client; applySupabaseBaseInit replays on one connection).
  // Reset the preamble settings at the end so a later borrower of that
  // connection does not inherit them. Targeted RESETs (not RESET ALL) leave any
  // other session state the caller set around this batch untouched.
  if (parts.length > 0) {
    for (const setting of plan.preamble) {
      parts.push(`RESET ${setting.name};`);
    }
  }
  return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
}
