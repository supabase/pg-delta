/**
 * Pure plan-to-SQL-files renderer for the `render` CLI command.
 *
 * Splits a plan's actions into dbmate-friendly `.sql` file bodies along the
 * SAME segment boundaries `apply()` uses at execution time
 * (src/apply/apply.ts::segmentActions), so a rendered file set reflects
 * exactly how the plan would be executed — including which statements share
 * a transaction and which run standalone (nonTransactional /
 * commitBoundaryAfter). No fs/process access here; see
 * src/cli/commands/render.ts for the argv/fs/exit-code wrapper.
 */
import { segmentActions } from "../apply/apply.ts";
import type { Plan } from "../plan/plan.ts";

export interface RenderOptions {
  /** allow destructive actions to be rendered. Off by default: rendering a
   *  plan that drops or rewrites data without acknowledging it is a common way
   *  to ship a destructive migration by accident. Gates BOTH `drop`-verb actions
   *  AND any action the planner marked `dataLoss: "destructive"` (e.g. an enum
   *  value-set migration that rewrites dependent columns, verb `alter`) — the
   *  verb alone misses those. */
  allowDrops: boolean;
}

export interface RenderedFile {
  /** null for a single-segment plan (`<base>.sql`); "_1", "_2", … in
   *  execution order when the plan splits into multiple segments. */
  suffix: string | null;
  contents: string;
  transactional: boolean;
  actionCount: number;
}

export interface RenderResult {
  /** false only when the plan has zero actions. */
  changes: boolean;
  files: RenderedFile[];
}

/** Normalize action SQL to end with exactly one semicolon (action.sql may or
 *  may not already have a trailing `;`, and may have trailing whitespace). */
function terminate(sql: string): string {
  const trimmed = sql.trimEnd();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

export function renderPlan(plan: Plan, opts: RenderOptions): RenderResult {
  if (plan.actions.length === 0) {
    return { changes: false, files: [] };
  }

  if (!opts.allowDrops) {
    // Gate on the plan's own safety metadata (dataLoss), not just the verb: a
    // destructive action can be a non-`drop` verb (an enum value-set migration
    // rewriting columns is an `alter`), and those would otherwise slip through.
    const offender = plan.actions.find(
      (a) => a.verb === "drop" || a.dataLoss === "destructive",
    );
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

  const files: RenderedFile[] = segments.map((segment, index) => {
    // preamble SETs + statements are one blank-line-separated group; the
    // non-transactional header (when present) is a single leading line, not
    // part of that blank-line rhythm.
    const header = segment.transactional
      ? ""
      : "-- pg-delta: transaction=false\n";
    const statements: string[] = [];
    for (const setting of plan.preamble) {
      statements.push(`set ${setting.name} = ${setting.value};`);
    }
    for (let i = segment.start; i < segment.end; i++) {
      statements.push(terminate(plan.actions[i]!.sql));
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
