import type { CapturedState, TableProofInput } from "./compare.ts";

const relKey = (t: TableProofInput): string =>
  JSON.stringify([t.schema, t.name]);

const withoutContent = (table: TableProofInput): TableProofInput => ({
  schema: table.schema,
  name: table.name,
  rows: table.rows,
  schemaSig: table.schemaSig,
});

/**
 * Dual-replay volatility mask: any table whose content fingerprint is
 * unstable across two original-chain replays is downgraded to count-only.
 */
export const applyVolatilityMask = (
  first: CapturedState,
  second: CapturedState,
): CapturedState => {
  const secondByKey = new Map(second.tables.map((t) => [relKey(t), t]));
  const tables = first.tables.map((table) => {
    const other = secondByKey.get(relKey(table));
    if (other === undefined || table.content !== other.content) {
      return withoutContent(table);
    }
    return table;
  });
  return { ...first, tables };
};
