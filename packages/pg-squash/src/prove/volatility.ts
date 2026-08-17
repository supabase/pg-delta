import type { CapturedState, TableProofInput } from "./compare.ts";

const relKey = (t: TableProofInput): string =>
  JSON.stringify([t.schema, t.name]);

const withoutContent = (table: TableProofInput): TableProofInput => ({
  schema: table.schema,
  name: table.name,
  rows: table.rows,
  schemaSig: table.schemaSig,
  ...(table.columnNames !== undefined
    ? { columnNames: table.columnNames }
    : {}),
  ...(table.rowCells !== undefined ? { rowCells: table.rowCells } : {}),
});

const stableColumns = (
  first: TableProofInput,
  second: TableProofInput | undefined,
): Record<string, string> | undefined => {
  const left = first.columnContent;
  if (left === undefined) return undefined;
  const right = second?.columnContent;
  const kept: Record<string, string> = {};
  for (const name of Object.keys(left).sort((a, b) => a.localeCompare(b))) {
    const fp = left[name];
    if (fp !== undefined && right?.[name] === fp) {
      kept[name] = fp;
    }
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
};

/**
 * Dual-replay volatility mask: columns whose fingerprints differ across two
 * original-chain replays are dropped. Remaining stable columns stay
 * fingerprinted. A table with no stable columns falls back to count-only
 * (whole-row content is stripped). Mixed volatile+stable tables are never
 * certified by row count alone.
 */
export const applyVolatilityMask = (
  first: CapturedState,
  second: CapturedState,
): CapturedState => {
  const secondByKey = new Map(second.tables.map((t) => [relKey(t), t]));
  const tables = first.tables.map((table) => {
    const other = secondByKey.get(relKey(table));
    if (other !== undefined && table.content === other.content) {
      return table;
    }
    const columns = stableColumns(table, other);
    return {
      ...withoutContent(table),
      ...(columns !== undefined ? { columnContent: columns } : {}),
    };
  });
  return { ...first, tables };
};
