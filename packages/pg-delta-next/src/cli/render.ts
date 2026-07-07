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
  /** allow `drop`-verb actions to be rendered. Off by default: rendering a
   *  plan containing drops without acknowledging it is a common way to ship
   *  a destructive migration by accident. */
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
    const offender = plan.actions.find((a) => a.verb === "drop");
    if (offender !== undefined) {
      throw new Error(
        `render: plan contains a drop action, refusing without --allow-drops: ${offender.sql}`,
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
