/**
 * Pure plan-to-SQL-files renderer.
 *
 * Splits a plan's actions into dbmate-friendly `.sql` file bodies along the
 * SAME segment boundaries `apply()` uses at execution time
 * (src/apply/apply.ts::segmentActions), so a rendered file set reflects
 * exactly how the plan would be executed — including which statements share
 * a transaction and which run standalone (nonTransactional /
 * commitBoundaryAfter).
 */
import { segmentActions } from "../apply/apply.ts";
import type { Plan } from "../plan/plan.ts";

export interface RenderPlanFilesOptions {
  /** allow destructive actions to be rendered. Off by default: rendering a
   *  plan that drops or rewrites data without acknowledging it is a common way
   *  to ship a destructive migration by accident. Gates BOTH `drop`-verb actions
   *  AND any action the planner marked `dataLoss: "destructive"`. */
  allowDrops: boolean;
}

export interface RenderedPlanFile {
  /** null for a single-segment plan (`<base>.sql`); "_1", "_2", … in
   *  execution order when the plan splits into multiple segments. */
  suffix: string | null;
  contents: string;
  transactional: boolean;
  actionCount: number;
}

export interface RenderPlanFilesResult {
  /** false only when the plan has zero actions. */
  changes: boolean;
  files: RenderedPlanFile[];
}

/** The planner marks destructive work two ways: a `drop` verb, or a non-drop
 *  verb flagged `dataLoss: "destructive"` (e.g. an enum value-set migration
 *  that rewrites dependent columns — verb `alter`). Shared by the render gate
 *  below and `schema apply --dry-run`'s warning so the predicate cannot drift. */
export function isDestructiveAction(
  action: Pick<Plan["actions"][number], "verb" | "dataLoss">,
): boolean {
  return action.verb === "drop" || action.dataLoss === "destructive";
}

/** Normalize action SQL to end with exactly one semicolon (action.sql may or
 *  may not already have a trailing `;`, and may have trailing whitespace). */
function terminate(sql: string): string {
  const trimmed = sql.trimEnd();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

export function renderPlanFiles(
  plan: Plan,
  opts: RenderPlanFilesOptions,
): RenderPlanFilesResult {
  if (plan.actions.length === 0) {
    return { changes: false, files: [] };
  }

  if (!opts.allowDrops) {
    const offender = plan.actions.find(isDestructiveAction);
    if (offender !== undefined) {
      const why =
        offender.verb === "drop" ? "a drop action" : "a destructive action";
      throw new Error(
        `render: plan contains ${why}, refusing without --allow-drops: ${offender.sql}`,
      );
    }
  }

  const segments = segmentActions(plan.actions);
  const multi = segments.length > 1;

  const files: RenderedPlanFile[] = segments.map((segment, index) => {
    const header = segment.transactional
      ? ""
      : "-- pg-delta: transaction=false\n";
    const statements: string[] = [];
    // Scope the preamble session settings so a reused runner session (sequential
    // migration runners share a connection) does not silently inherit them —
    // mirroring apply() (src/apply/apply.ts): SET LOCAL inside a transactional
    // segment (reverts at COMMIT), plain SET + a trailing RESET ALL around a
    // standalone non-transactional action (SET LOCAL is a no-op outside a
    // transaction). A transactional dbmate file runs inside its own BEGIN/COMMIT.
    for (const setting of plan.preamble) {
      statements.push(
        segment.transactional
          ? `set local ${setting.name} = ${setting.value};`
          : `set ${setting.name} = ${setting.value};`,
      );
    }
    for (let i = segment.start; i < segment.end; i++) {
      statements.push(terminate(plan.actions[i]!.sql));
    }
    // A non-transactional file cannot rely on COMMIT to drop its SETs, so reset
    // them explicitly at the end (only when there was a preamble to reset).
    if (!segment.transactional && plan.preamble.length > 0) {
      statements.push("reset all;");
    }
    return {
      suffix: multi ? `_${index + 1}` : null,
      contents: `${header}${statements.join("\n\n")}\n`,
      transactional: segment.transactional,
      actionCount: segment.end - segment.start,
    };
  });

  return { changes: true, files };
}
