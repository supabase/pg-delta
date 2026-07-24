import type { Plan } from "../plan/plan.ts";
import {
  buildApplyPreamble,
  type ApplyTimeoutOptions,
} from "../apply/apply-preamble.ts";
import { segmentActions } from "../apply/apply.ts";

function terminate(sql: string): string {
  const trimmed = sql.trimEnd();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

const EXECUTION_CONTRACT = `-- pg-delta schema apply --dry-run
-- Execute statements one at a time, in order, on one database session.
-- Stop on the first error and preserve autocommit outside BEGIN/COMMIT blocks.
-- Do not submit this as one multi-statement request or wrap it in one transaction.`;

/** Render the portable SQL statement sequence that apply() sends on success. */
export function renderApplyScript(
  plan: Plan,
  timeoutOptions?: ApplyTimeoutOptions,
): string {
  if (plan.actions.length === 0) return "";

  const segments = segmentActions(plan.actions);
  const rendered = segments.map((segment) => {
    const statements: string[] = [];
    if (segment.transactional) statements.push("BEGIN;");
    statements.push(
      ...buildApplyPreamble(plan, timeoutOptions, segment.transactional).map(
        terminate,
      ),
    );
    for (let index = segment.start; index < segment.end; index++) {
      statements.push(terminate(plan.actions[index]!.sql));
    }
    statements.push(segment.transactional ? "COMMIT;" : "RESET ALL;");
    return statements.join("\n");
  });

  return `${EXECUTION_CONTRACT}\n\n${rendered.join("\n\n")}\n`;
}
