import { describe, expect, test } from "bun:test";
import {
  type BatchRunner,
  openExtractionSession,
  type Row,
  workerSessionStatements,
} from "./scope.ts";

/** A BatchRunner that records the batch it was handed and replays canned rows.
 *  `rowsFor` is keyed by statement index, mirroring node-pg's per-statement
 *  result array. */
function fakeBatch(rowsFor: Record<number, Row[]> = {}): {
  run: BatchRunner;
  batches: { statements: readonly string[]; label: string }[];
} {
  const batches: { statements: readonly string[]; label: string }[] = [];
  const run: BatchRunner = async (statements, label) => {
    batches.push({ statements, label });
    return statements.map((_unused, index) => rowsFor[index] ?? []);
  };
  return { run, batches };
}

const VERSION_ROWS = [{ version: "17.10", num: 170010 }] as Row[];

describe("openExtractionSession", () => {
  test("opens, canonicalizes and probes in ONE batch", async () => {
    const { run, batches } = fakeBatch({ 2: VERSION_ROWS });
    const opened = await openExtractionSession(run, undefined, false);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.statements).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SET LOCAL search_path TO 'pg_catalog'",
      `SELECT current_setting('server_version') AS version, current_setting('server_version_num')::int AS num`,
    ]);
    expect(opened.version).toEqual({
      serverVersion: "17.10",
      serverVersionNum: 170010,
      pgMajor: 17,
    });
    expect(opened.snapshotId).toBeUndefined();
  });

  test("a statement budget joins the same batch and shifts the probe slot", async () => {
    // the probe must be read from its ACTUAL index, not a hardcoded one
    const { run, batches } = fakeBatch({ 3: VERSION_ROWS });
    const opened = await openExtractionSession(run, 1500, false);
    expect(batches[0]!.statements).toHaveLength(4);
    expect(batches[0]!.statements[2]).toBe(
      "SET LOCAL statement_timeout = 1500",
    );
    expect(opened.version.pgMajor).toBe(17);
  });

  test("a fractional / negative budget is floored to a safe integer", async () => {
    const { batches, run } = fakeBatch({ 3: VERSION_ROWS });
    await openExtractionSession(run, 12.7, false);
    expect(batches[0]!.statements[2]).toBe("SET LOCAL statement_timeout = 12");
    const negative = fakeBatch({ 3: VERSION_ROWS });
    await openExtractionSession(negative.run, -5, false);
    expect(negative.batches[0]!.statements[2]).toBe(
      "SET LOCAL statement_timeout = 0",
    );
  });

  test("the snapshot export rides in the same batch, last", async () => {
    const { run, batches } = fakeBatch({
      2: VERSION_ROWS,
      3: [{ id: "00000004-00000002-1" }] as Row[],
    });
    const opened = await openExtractionSession(run, undefined, true);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.statements.at(-1)).toBe(
      "SELECT pg_export_snapshot() AS id",
    );
    expect(opened.snapshotId).toBe("00000004-00000002-1");
  });

  test("a non-string snapshot id is treated as no snapshot", async () => {
    const { run } = fakeBatch({ 2: VERSION_ROWS, 3: [{ id: null }] as Row[] });
    expect(
      (await openExtractionSession(run, undefined, true)).snapshotId,
    ).toBeUndefined();
  });

  test("an empty probe result degrades to an unknown version, not a throw", async () => {
    const { run } = fakeBatch();
    const opened = await openExtractionSession(run, undefined, false);
    expect(opened.version).toEqual({
      serverVersion: "unknown",
      serverVersionNum: 0,
      pgMajor: 0,
    });
  });

  test("the batch carries a stable label for timeout attribution", async () => {
    const { run, batches } = fakeBatch({ 2: VERSION_ROWS });
    await openExtractionSession(run, 10, false);
    expect(batches[0]!.label).toBe("session setup");
  });
});

describe("workerSessionStatements", () => {
  test("imports the snapshot immediately after BEGIN", async () => {
    // Postgres rejects SET TRANSACTION SNAPSHOT once the transaction has run any
    // query, so its position is load-bearing, not cosmetic.
    const statements = workerSessionStatements("00000004-2-1", undefined, 17);
    expect(statements[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(statements[1]).toBe("SET TRANSACTION SNAPSHOT '00000004-2-1'");
  });

  test("adopts the coordinator's session, JIT-off included", () => {
    const statements = workerSessionStatements("s1", 2000, 17);
    expect(statements).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SET TRANSACTION SNAPSHOT 's1'",
      "SET LOCAL search_path TO 'pg_catalog'",
      "SET LOCAL statement_timeout = 2000",
      "SELECT set_config('jit', 'off', true) WHERE has_parameter_privilege(current_user, 'jit', 'SET')",
    ]);
  });

  test("uses the plain SET form on PG 14, which has no parameter ACLs", () => {
    // has_parameter_privilege() does not exist before 15 — referencing it would
    // make the whole batch error, aborting the worker's transaction
    expect(workerSessionStatements("s1", undefined, 14).at(-1)).toBe(
      "SET LOCAL jit = off",
    );
  });
});
