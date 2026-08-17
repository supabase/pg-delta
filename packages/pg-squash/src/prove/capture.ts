import { createHash } from "node:crypto";
import { collectTableStats, extract } from "@supabase/pg-delta";
import type { Pool } from "pg";
import { qid } from "../shadow/index.ts";
import type { LedgerDiff } from "../shadow/index.ts";
import type { CapturedState, TableProofInput } from "./compare.ts";

const parseRelKey = (
  key: string,
): { schema: string; name: string } | undefined => {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const schema = parsed[0];
    const name = parsed[1];
    if (typeof schema !== "string" || typeof name !== "string")
      return undefined;
    return { schema, name };
  } catch {
    return undefined;
  }
};

const relKey = (schema: string, name: string): string =>
  JSON.stringify([schema, name]);

const md5 = (parts: string[]): string =>
  createHash("md5").update(parts.join("\n")).digest("hex");

const tryDisableRowSecurity = async (pool: Pool): Promise<void> => {
  try {
    await pool.query("SET row_security = off");
  } catch {
    // CREATEDB without BYPASSRLS cannot disable RLS; continue.
  }
};

type ColumnRows = {
  columnNames: string[];
  rowCells: string[][];
  columnContent: Record<string, string>;
};

const collectColumnRows = async (
  pool: Pool,
  tables: { schema: string; name: string; rows: number }[],
): Promise<Map<string, ColumnRows>> => {
  const result = new Map<string, ColumnRows>();
  const nonempty = tables.filter((t) => t.rows > 0);
  if (nonempty.length === 0) return result;

  const cols = await pool.query<{
    schema: string;
    name: string;
    attname: string;
  }>(`
    SELECT n.nspname AS schema, c.relname AS name, a.attname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attnum > 0 AND NOT a.attisdropped
      AND c.relkind IN ('r', 'm')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'
    ORDER BY 1, 2, a.attnum`);

  const grouped = new Map<string, string[]>();
  for (const row of cols.rows) {
    const key = relKey(row.schema, row.name);
    const list = grouped.get(key) ?? [];
    list.push(row.attname);
    grouped.set(key, list);
  }

  for (const table of nonempty) {
    const key = relKey(table.schema, table.name);
    const attnames = grouped.get(key);
    if (attnames === undefined || attnames.length === 0) continue;
    const rel = `${qid(table.schema)}.${qid(table.name)}`;
    const selects = attnames.map(
      (attname) => `COALESCE(${qid(attname)}::text, '') AS ${qid(attname)}`,
    );
    const rows = await pool.query<Record<string, unknown>>(
      `SELECT ${selects.join(", ")} FROM ${rel}`,
    );
    const rowCells: string[][] = [];
    const perColumn: string[][] = attnames.map(() => []);
    for (const row of rows.rows) {
      const cells: string[] = [];
      attnames.forEach((attname, i) => {
        const value = row[attname];
        const text = typeof value === "string" ? value : "";
        cells.push(text);
        perColumn[i]?.push(text);
      });
      rowCells.push(cells);
    }
    const columnContent: Record<string, string> = {};
    attnames.forEach((attname, i) => {
      const values = perColumn[i];
      if (values === undefined) return;
      columnContent[attname] = md5(
        [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    });
    if (Object.keys(columnContent).length > 0) {
      result.set(key, { columnNames: attnames, rowCells, columnContent });
    }
  }
  return result;
};

/**
 * Extract + collectTableStats while the replay DB and its ledger effects
 * still exist. Caller must revert the cluster ledger afterwards.
 */
export const captureProofState = async (
  pool: Pool,
  ledger: LedgerDiff,
  options?: { extractConcurrency?: number },
): Promise<CapturedState> => {
  await tryDisableRowSecurity(pool);
  const extracted = await extract(
    pool,
    options?.extractConcurrency !== undefined
      ? { concurrency: options.extractConcurrency }
      : {},
  );
  const stats = await collectTableStats(pool);
  const tables: TableProofInput[] = [];
  for (const [key, stat] of stats) {
    const ident = parseRelKey(key);
    if (ident === undefined) continue;
    tables.push({
      schema: ident.schema,
      name: ident.name,
      rows: stat.rows,
      schemaSig: stat.schemaSig,
      ...(stat.content !== undefined ? { content: stat.content } : {}),
    });
  }
  const columns = await collectColumnRows(pool, tables);
  for (const table of tables) {
    const extra = columns.get(relKey(table.schema, table.name));
    if (extra === undefined) continue;
    table.columnContent = extra.columnContent;
    table.columnNames = extra.columnNames;
    table.rowCells = extra.rowCells;
  }
  tables.sort(
    (a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name),
  );
  return {
    rootHash: extracted.factBase.rootHash,
    ledger,
    tables,
  };
};
