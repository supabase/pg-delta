import type { Plan } from "../plan/plan.ts";
import {
  buildApplyPreamble,
  type ApplyTimeoutOptions,
} from "./apply-preamble.ts";
import { segmentActions } from "./apply.ts";

function terminate(sql: string): string {
  const trimmed = sql.trimEnd();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

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

  return `${rendered.join("\n\n")}\n`;
}
