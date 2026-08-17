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

const statementKey = (file: string, statementIndex: number): string =>
  `${file}:${String(statementIndex)}`;

export const pack = (
  items: PackItem[],
  splitBefore: ReadonlySet<string> = new Set(),
): {
  segments: Segment[];
  diagnostics: Diagnostic[];
  statementKeys: string[];
} => {
  const segments: Segment[] = [];
  const diagnostics: Diagnostic[] = [];
  const statementKeys: string[] = [];
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
    const key = statementKey(
      item.stmt.source.file,
      item.stmt.source.statementIndex,
    );
    if (splitBefore.has(key) && item.floorId === null) {
      flush();
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
        statementKeys.push(key);
        continue;
      }
      flush();
      segments.push({ type: "barrier", statement: item.stmt });
      statementKeys.push(key);
      continue;
    }
    current.push(item.stmt);
    statementKeys.push(key);
  }
  flush();
  return { segments, diagnostics, statementKeys };
};
