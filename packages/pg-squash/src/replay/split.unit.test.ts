import { describe, expect, test } from "bun:test";
import { splitReplayStatements } from "./split.ts";

describe("splitReplayStatements", () => {
  test("keeps authored BEGIN/COMMIT unlike ingest", async () => {
    const sql = "BEGIN;\nCREATE TABLE t (id int);\nCOMMIT;";
    const statements = await splitReplayStatements(sql, "txn.sql");
    expect(statements).toEqual([
      "BEGIN;",
      "CREATE TABLE t (id int);",
      "COMMIT;",
    ]);
  });

  test("carries COPY FROM stdin as a single query", async () => {
    const sql = "COPY t FROM stdin;\n1\n\\.\n";
    expect(await splitReplayStatements(sql, "copy.sql")).toEqual([sql]);
  });
});
