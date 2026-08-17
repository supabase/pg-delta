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
  test("wraps txn segments and records provenance plus a manifest", () => {
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
      -- pg-squash: from 20240102_b.sql
      BEGIN;
      CREATE TABLE t (id int);
      CREATE INDEX t_id ON t (id);
      COMMIT;
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
