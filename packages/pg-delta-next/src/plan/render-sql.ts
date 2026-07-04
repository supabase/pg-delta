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
  return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
}
