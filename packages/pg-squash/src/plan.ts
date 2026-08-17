import { classifyStatement } from "./classify/index.ts";
import { emit } from "./emit/index.ts";
import { ingestChain } from "./ingest/index.ts";
import type { IngestedFile } from "./ingest/index.ts";
import type { Diagnostic } from "./model/index.ts";
import type { PackItem } from "./pack/index.ts";
import type { Segment, SquashStatement } from "./model/index.ts";

export type PlanSquashResult = {
  files: { name: string; sql: string }[];
  manifest: unknown;
  diagnostics: Diagnostic[];
  refused: boolean;
  statementKeys: string[];
};

type PlanSquashOptions = {
  splitBefore?: ReadonlySet<string>;
  forceBarrier?: ReadonlySet<string>;
};

export const statementKey = (file: string, statementIndex: number): string =>
  `${file}:${String(statementIndex)}`;

const floorIdAt = (
  floors: { start: number; end: number }[],
  index: number,
): number | null => {
  for (let i = 0; i < floors.length; i += 1) {
    const floor = floors[i];
    if (floor !== undefined && index >= floor.start && index < floor.end) {
      return i;
    }
  }
  return null;
};

const toPackItems = (
  files: IngestedFile[],
  pgMajor: number,
  diagnostics: Diagnostic[],
  forceBarrier: ReadonlySet<string>,
): { items: PackItem[]; refused: boolean } => {
  const items: PackItem[] = [];
  let refused = false;
  for (const file of files) {
    if (file.kind === "opaque") {
      items.push({ type: "opaque", file: file.file, sql: file.sql });
      continue;
    }
    file.statements.forEach((stmt, index) => {
      const classified = classifyStatement(stmt.text, pgMajor);
      if (classified.refused) {
        refused = true;
        diagnostics.push({
          code: "refused-statement",
          message: `${stmt.source.file}: ${classified.refuseReason ?? "refused"}`,
          source: stmt.source,
        });
      }
      const key = statementKey(stmt.source.file, stmt.source.statementIndex);
      items.push({
        type: "statement",
        stmt,
        isBarrier: classified.isBarrier || forceBarrier.has(key),
        floorId: floorIdAt(file.floors, index),
      });
    });
  }
  return { items, refused };
};

const packWithSplits = (
  items: PackItem[],
  splitBefore: ReadonlySet<string>,
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
    if (splitBefore.has(key)) {
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

/** Frontend-only: ingest → classify → pack → emit. No Docker. */
export const planSquash = async (
  chain: { name: string; sql: string }[],
  pgMajor: number,
  options: PlanSquashOptions = {},
): Promise<PlanSquashResult> => {
  const ingested = await ingestChain(chain);
  const diagnostics: Diagnostic[] = [...ingested.diagnostics];
  const packed = toPackItems(
    ingested.files,
    pgMajor,
    diagnostics,
    options.forceBarrier ?? new Set(),
  );
  const {
    segments,
    diagnostics: packDiag,
    statementKeys,
  } = packWithSplits(packed.items, options.splitBefore ?? new Set());
  diagnostics.push(...packDiag);
  const emitted = emit(segments);
  return {
    files: emitted.files,
    manifest: emitted.manifest,
    diagnostics,
    refused: packed.refused,
    statementKeys,
  };
};

/** Next statement key to split before, or undefined if already fully split. */
export const nextMidpointSplit = (
  keys: readonly string[],
  already: ReadonlySet<string>,
): string | undefined => {
  if (keys.length < 2) return undefined;
  const mid = keys[Math.floor(keys.length / 2)];
  if (mid !== undefined && !already.has(mid) && mid !== keys[0]) return mid;
  for (const key of keys.slice(1)) {
    if (!already.has(key)) return key;
  }
  return undefined;
};
