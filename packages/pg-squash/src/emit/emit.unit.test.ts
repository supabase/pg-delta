import { describe, expect, test } from "bun:test";
import type { Segment, SquashStatement } from "../model/statement.ts";
import { emit } from "./index.ts";

const stmt = (text: string, file: string, index = 0): SquashStatement => ({
  text,
  source: {
    file,
    statementIndex: index,
    bytes: { start: 0, end: text.length },
  },
});

describe("emit", () => {
  test("annotates each source-file run without injecting BEGIN/COMMIT", () => {
    const segments: Segment[] = [
      {
        type: "txn",
        statements: [
          stmt("CREATE TABLE t (id int);", "20240101_a.sql"),
          stmt("CREATE INDEX t_id ON t (id);", "20240102_b.sql", 0),
        ],
      },
    ];
    const { files, manifest } = emit(segments);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("0001_squashed.sql");
    expect(files[0]?.sql).toMatchInlineSnapshot(`
      "-- pg-squash: from 20240101_a.sql
      CREATE TABLE t (id int);
      -- pg-squash: from 20240102_b.sql
      CREATE INDEX t_id ON t (id);
      "
    `);
    expect(manifest).toEqual([
      {
        outputFile: "0001_squashed.sql",
        statementIndex: 0,
        source:
          segments[0] && segments[0].type === "txn"
            ? segments[0].statements[0]!.source
            : stmt("x", "x").source,
      },
      {
        outputFile: "0001_squashed.sql",
        statementIndex: 1,
        source:
          segments[0] && segments[0].type === "txn"
            ? segments[0].statements[1]!.source
            : stmt("x", "x").source,
      },
    ]);
  });

  test("one provenance comment per source-file run, not per statement", () => {
    const { files } = emit([
      {
        type: "txn",
        statements: [
          stmt("CREATE TABLE a (id int);", "a.sql", 0),
          stmt("CREATE TABLE b (id int);", "a.sql", 1),
          stmt("CREATE TABLE c (id int);", "b.sql", 0),
        ],
      },
    ]);
    expect(files[0]?.sql).toMatchInlineSnapshot(`
      "-- pg-squash: from a.sql
      CREATE TABLE a (id int);
      CREATE TABLE b (id int);
      -- pg-squash: from b.sql
      CREATE TABLE c (id int);
      "
    `);
  });

  test("wrapTransactions adds BEGIN/COMMIT when the user did not", () => {
    const { files } = emit(
      [
        {
          type: "txn",
          statements: [
            stmt("CREATE TABLE t (id int);", "a.sql"),
            stmt("CREATE INDEX t_id ON t (id);", "b.sql"),
          ],
        },
      ],
      { wrapTransactions: true },
    );
    expect(files[0]?.sql).toMatchInlineSnapshot(`
      "BEGIN;
      -- pg-squash: from a.sql
      CREATE TABLE t (id int);
      -- pg-squash: from b.sql
      CREATE INDEX t_id ON t (id);
      COMMIT;
      "
    `);
  });

  test("wrapTransactions does not nest around authored BEGIN/COMMIT", () => {
    const begin = stmt("BEGIN;", "txn.sql", 0);
    begin.txn = "begin";
    const body = stmt("CREATE TABLE t (id int);", "txn.sql", 1);
    const commit = stmt("COMMIT;", "txn.sql", 2);
    commit.txn = "commit";
    const { files } = emit(
      [{ type: "txn", statements: [begin, body, commit] }],
      { wrapTransactions: true },
    );
    expect(files[0]?.sql).toMatchInlineSnapshot(`
      "-- pg-squash: from txn.sql
      BEGIN;
      CREATE TABLE t (id int);
      COMMIT;
      "
    `);
  });

  test("tags barrier files for the current CLI apply wrapper", () => {
    const segments: Segment[] = [
      {
        type: "barrier",
        statement: stmt("CREATE INDEX CONCURRENTLY t_id ON t (id);", "idx.sql"),
      },
    ];
    const { files } = emit(segments);
    expect(files[0]?.sql).toMatchInlineSnapshot(`
      "-- pg-delta: transaction=false
      -- pg-squash: no-transaction
      -- pg-squash: from idx.sql
      CREATE INDEX CONCURRENTLY t_id ON t (id);
      "
    `);
  });

  test("emits opaque files verbatim with provenance", () => {
    const sql = "COPY t FROM stdin;\n1\ta\n\\.\n";
    const { files, manifest } = emit([
      { type: "opaqueFile", file: "copy.sql", sql },
    ]);
    expect(files[0]?.name).toBe("0001_squashed.sql");
    expect(files[0]?.sql).toMatchInlineSnapshot(`
      "-- pg-squash: from copy.sql
      COPY t FROM stdin;
      1	a
      \\.
      "
    `);
    expect(manifest).toHaveLength(0);
  });
});
