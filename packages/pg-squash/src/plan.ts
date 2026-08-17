import { classifyStatement, refusedReasonInSql } from "./classify/index.ts";
import { emit } from "./emit/index.ts";
import type { ManifestEntry } from "./emit/index.ts";
import { ingestChain } from "./ingest/index.ts";
import type { IngestedFile } from "./ingest/index.ts";
import type { Diagnostic } from "./model/index.ts";
import { pack } from "./pack/index.ts";
import type { PackItem } from "./pack/index.ts";

export type PlanSquashResult = {
  files: { name: string; sql: string }[];
  manifest: ManifestEntry[];
  diagnostics: Diagnostic[];
  refused: boolean;
  statementKeys: string[];
};

type PlanSquashOptions = {
  splitBefore?: ReadonlySet<string>;
  forceBarrier?: ReadonlySet<string>;
  wrapTransactions?: boolean;
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
      const reason = refusedReasonInSql(file.sql);
      if (reason !== undefined) {
        refused = true;
        diagnostics.push({
          code: "refused-statement",
          message: `${file.file}: ${reason}`,
        });
      }
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
  } = pack(packed.items, options.splitBefore ?? new Set());
  diagnostics.push(...packDiag);
  const emitted = emit(segments, {
    wrapTransactions: options.wrapTransactions,
  });
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
