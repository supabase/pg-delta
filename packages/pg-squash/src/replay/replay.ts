import type { Pool, PoolClient } from "pg";
import { isNonTransactional, sqlStateOf } from "./errors.ts";
import { planFileExecution, type ReplayFilePlan } from "./runner-semantics.ts";
import { splitReplayStatements } from "./split.ts";

export type ReplayFile = {
  name: string;
  sql: string;
};

export type ReplayFailure = {
  file: string;
  statementIndex: number;
  sql: string;
  sqlstate?: string;
  message: string;
  nonTransactional: boolean;
};

export type ReplayResult = { ok: true } | { ok: false; failure: ReplayFailure };

type ExecFailure = {
  statementIndex: number;
  sql: string;
  error: unknown;
};

const failFrom = (file: string, failure: ExecFailure): ReplayResult => {
  const sqlstate = sqlStateOf(failure.error);
  return {
    ok: false,
    failure: {
      file,
      statementIndex: failure.statementIndex,
      sql: failure.sql,
      ...(sqlstate !== undefined ? { sqlstate } : {}),
      message:
        failure.error instanceof Error
          ? failure.error.message
          : String(failure.error),
      nonTransactional: isNonTransactional(failure.error),
    },
  };
};

const executeSequential = async (
  client: PoolClient,
  statements: readonly string[],
  cleanup: string,
): Promise<ExecFailure | undefined> => {
  for (let i = 0; i < statements.length; i += 1) {
    const sql = statements[i];
    if (sql === undefined) continue;
    try {
      await client.query(sql);
    } catch (error) {
      await client.query(cleanup).catch(() => {});
      return { statementIndex: i, sql, error };
    }
  }
  return undefined;
};

const executeWrapped = async (
  client: PoolClient,
  plan: Extract<ReplayFilePlan, { mode: "wrapped" }>,
): Promise<ExecFailure | undefined> => {
  let index = 0;
  for (const batch of plan.batches) {
    if (batch.kind === "standalone") {
      try {
        await client.query(batch.sql);
      } catch (error) {
        return { statementIndex: index, sql: batch.sql, error };
      }
      index += 1;
      continue;
    }
    if (batch.statements.length === 0) continue;
    try {
      await client.query("BEGIN");
    } catch (error) {
      return { statementIndex: index, sql: "BEGIN", error };
    }
    for (const sql of batch.statements) {
      try {
        await client.query(sql);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        return { statementIndex: index, sql, error };
      }
      index += 1;
    }
    try {
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return { statementIndex: index - 1, sql: "COMMIT", error };
    }
  }
  return undefined;
};

const executePlan = async (
  client: PoolClient,
  plan: ReplayFilePlan,
): Promise<ExecFailure | undefined> => {
  if (plan.mode === "sequential") {
    const cleanup = plan.reason === "no-transaction" ? "RESET ALL" : "ROLLBACK";
    return executeSequential(client, plan.statements, cleanup);
  }
  return executeWrapped(client, plan);
};

/**
 * Replay a migration chain on one connection with CLI-accurate wrapping:
 * `RESET ALL` before each file, then per-file `BEGIN`/`COMMIT` unless the
 * file opts out via `-- pg-delta: transaction=false`, authored txn control,
 * or a pipeline-incompatible statement (flushed and run standalone).
 */
export const replayChain = async (
  pool: Pool,
  files: readonly ReplayFile[],
): Promise<ReplayResult> => {
  const client = await pool.connect();
  try {
    for (const file of files) {
      try {
        await client.query("RESET ALL");
      } catch (error) {
        return failFrom(file.name, {
          statementIndex: -1,
          sql: "RESET ALL",
          error,
        });
      }
      const statements = await splitReplayStatements(file.sql, file.name);
      const plan = planFileExecution(file.sql, statements);
      const failure = await executePlan(client, plan);
      if (failure !== undefined) {
        return failFrom(file.name, failure);
      }
    }
    return { ok: true };
  } finally {
    client.release();
  }
};
