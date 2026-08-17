import type { Diagnostic } from "../model/diagnostics.ts";
import type { Segment, SquashStatement } from "../model/statement.ts";

export type PackItem =
  | {
      type: "statement";
      stmt: SquashStatement;
      isBarrier: boolean;
      floorId: number | null;
    }
  | { type: "opaque"; file: string; sql: string };

export const pack = (
  items: PackItem[],
): { segments: Segment[]; diagnostics: Diagnostic[] } => {
  const segments: Segment[] = [];
  const diagnostics: Diagnostic[] = [];
  let current: SquashStatement[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    segments.push({ type: "txn", statements: current });
    current = [];
  };

  for (const item of items) {
    if (item.type === "opaque") {
      flush();
      segments.push({
        type: "opaqueFile",
        file: item.file,
        sql: item.sql,
      });
      continue;
    }
    if (item.isBarrier) {
      if (item.floorId !== null) {
        diagnostics.push({
          code: "explicit-txn-floor",
          message:
            "A non-transactional statement sits inside an explicit BEGIN/COMMIT floor; the floor is kept intact.",
          source: item.stmt.source,
        });
        current.push(item.stmt);
        continue;
      }
      flush();
      segments.push({ type: "barrier", statement: item.stmt });
      continue;
    }
    current.push(item.stmt);
  }
  flush();
  return { segments, diagnostics };
};
