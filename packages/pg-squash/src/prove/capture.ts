import { collectTableStats, extract } from "@supabase/pg-delta";
import type { Pool } from "pg";
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

/**
 * Extract + collectTableStats while the replay DB and its ledger effects
 * still exist. Caller must revert the cluster ledger afterwards.
 */
export const captureProofState = async (
  pool: Pool,
  ledger: LedgerDiff,
  options?: { extractConcurrency?: number },
): Promise<CapturedState> => {
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
  tables.sort(
    (a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name),
  );
  return {
    rootHash: extracted.factBase.rootHash,
    ledger,
    tables,
  };
};
