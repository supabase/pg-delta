import { maskSql } from "./mask.ts";

const SUPPORTED_MAJORS = new Set([14, 15, 16, 17, 18]);

const BARRIER_RULES: { name: string; re: RegExp }[] = [
  {
    name: "CREATE INDEX CONCURRENTLY",
    re: /^\s*create\s+(unique\s+)?index\s+concurrently\b/i,
  },
  {
    name: "DROP INDEX CONCURRENTLY",
    re: /^\s*drop\s+index\s+concurrently\b/i,
  },
  {
    name: "REINDEX CONCURRENTLY",
    re: /^\s*reindex\b[\s\S]*\bconcurrently\b/i,
  },
  {
    name: "REFRESH MATERIALIZED VIEW CONCURRENTLY",
    re: /^\s*refresh\s+materialized\s+view\s+concurrently\b/i,
  },
  { name: "VACUUM", re: /^\s*vacuum\b/i },
  { name: "ALTER SYSTEM", re: /^\s*alter\s+system\b/i },
  { name: "CLUSTER", re: /^\s*cluster\b/i },
  { name: "CREATE DATABASE", re: /^\s*create\s+database\b/i },
  { name: "DROP DATABASE", re: /^\s*drop\s+database\b/i },
  { name: "CREATE TABLESPACE", re: /^\s*create\s+tablespace\b/i },
  { name: "DROP TABLESPACE", re: /^\s*drop\s+tablespace\b/i },
  { name: "ALTER TABLESPACE", re: /^\s*alter\s+tablespace\b/i },
];

const REFUSAL_RULES: { name: string; re: RegExp }[] = [
  { name: "ALTER SYSTEM", re: /^\s*alter\s+system\b/i },
  { name: "CREATE DATABASE", re: /^\s*create\s+database\b/i },
  { name: "DROP DATABASE", re: /^\s*drop\s+database\b/i },
  { name: "CREATE TABLESPACE", re: /^\s*create\s+tablespace\b/i },
  { name: "DROP TABLESPACE", re: /^\s*drop\s+tablespace\b/i },
  { name: "ALTER TABLESPACE", re: /^\s*alter\s+tablespace\b/i },
  { name: "CREATE SUBSCRIPTION", re: /^\s*create\s+subscription\b/i },
  { name: "ALTER SUBSCRIPTION", re: /^\s*alter\s+subscription\b/i },
  { name: "DROP SUBSCRIPTION", re: /^\s*drop\s+subscription\b/i },
];

const CLUSTER_HINT_RULES: { name: string; re: RegExp }[] = [
  {
    name: "CREATE ROLE",
    re: /^\s*create\s+(role|user(?!\s+mapping)|group)\b/i,
  },
  {
    name: "ALTER ROLE",
    re: /^\s*alter\s+(role|user(?!\s+mapping)|group)\b/i,
  },
  {
    name: "DROP ROLE",
    re: /^\s*drop\s+(role|user(?!\s+mapping)|group)\b/i,
  },
  { name: "COMMENT ON ROLE", re: /^\s*comment\s+on\s+role\b/i },
  {
    name: "GRANT membership",
    re: /^\s*grant\b(?![\s\S]*\bon\b)/i,
  },
  {
    name: "REVOKE membership",
    re: /^\s*revoke\b(?![\s\S]*\bon\b)/i,
  },
];

export type StatementClass = {
  isBarrier: boolean;
  barrierName?: string;
  clusterScope: boolean;
  clusterHint?: string;
  refused: boolean;
  refuseReason?: string;
};

const firstStatement = (sql: string): string => {
  const masked = maskSql(sql).trim();
  const semi = masked.indexOf(";");
  return (semi === -1 ? masked : masked.slice(0, semi)).trim();
};

export const classifyStatement = (
  sql: string,
  pgMajor: number,
): StatementClass => {
  if (!SUPPORTED_MAJORS.has(pgMajor)) {
    return classifyStatement(sql, 17);
  }
  const stmt = firstStatement(sql);
  const barrier = BARRIER_RULES.find((r) => r.re.test(stmt));
  const refusal = REFUSAL_RULES.find((r) => r.re.test(stmt));
  const cluster = CLUSTER_HINT_RULES.find((r) => r.re.test(stmt));
  return {
    isBarrier: barrier !== undefined,
    ...(barrier !== undefined ? { barrierName: barrier.name } : {}),
    clusterScope: cluster !== undefined,
    ...(cluster !== undefined ? { clusterHint: cluster.name } : {}),
    refused: refusal !== undefined,
    ...(refusal !== undefined ? { refuseReason: refusal.name } : {}),
  };
};

/** Scan every semicolon-delimited chunk so opaque files cannot skip refusals. */
export const refusedReasonInSql = (sql: string): string | undefined => {
  const masked = maskSql(sql);
  for (const part of masked.split(";")) {
    const hit = REFUSAL_RULES.find((r) => r.re.test(part));
    if (hit !== undefined) return hit.name;
  }
  return undefined;
};
