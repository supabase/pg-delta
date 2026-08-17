import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestChain, readChain, splitSqlFile } from "./index.ts";

const utf8Len = (s: string): number => new TextEncoder().encode(s).length;

describe("splitSqlFile", () => {
  test("splits statements with UTF-8 byte offsets", async () => {
    const sql = "COMMENT ON TABLE t IS '→→→';";
    const { result, diagnostics } = await splitSqlFile("c.sql", sql);
    expect(diagnostics).toHaveLength(0);
    expect(result.kind).toBe("statements");
    if (result.kind !== "statements") return;
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]?.text).toBe(sql);
    expect(result.statements[0]?.source.bytes).toEqual({
      start: 0,
      end: utf8Len(sql),
    });
    expect(result.statements[0]?.source.bytes.end).toBeGreaterThan(sql.length);
  });

  test("keeps explicit BEGIN/COMMIT and records an atomicity floor", async () => {
    const sql = `
BEGIN;
CREATE TABLE t (id int);
INSERT INTO t VALUES (1);
COMMIT;
CREATE INDEX t_id ON t (id);
`;
    const { result } = await splitSqlFile("txn.sql", sql);
    expect(result.kind).toBe("statements");
    if (result.kind !== "statements") return;
    expect(result.statements.map((s) => s.text)).toEqual([
      "BEGIN;",
      "CREATE TABLE t (id int);",
      "INSERT INTO t VALUES (1);",
      "COMMIT;",
      "CREATE INDEX t_id ON t (id);",
    ]);
    expect(result.statements[0]?.txn).toBe("begin");
    expect(result.statements[3]?.txn).toBe("commit");
    expect(result.floors).toEqual([{ start: 0, end: 4 }]);
  });

  test("carries SAVEPOINT files as opaque units", async () => {
    const sql =
      "BEGIN;\nSAVEPOINT sp;\nINSERT INTO t VALUES (1);\nRELEASE sp;\nCOMMIT;";
    const { result, diagnostics } = await splitSqlFile("sp.sql", sql);
    expect(result).toEqual({ kind: "opaque", file: "sp.sql", sql });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "opaque-file" }),
    );
  });

  test("carries COPY FROM stdin files as opaque units", async () => {
    const sql = "COPY t FROM stdin;\n1\ta\n\\.\n";
    const { result, diagnostics } = await splitSqlFile("copy.sql", sql);
    expect(result.kind).toBe("opaque");
    expect(diagnostics[0]?.code).toBe("opaque-file");
  });

  test("carries psql meta-command files as opaque units", async () => {
    const sql = "\\set ON_ERROR_STOP on\nCREATE TABLE t (id int);\n";
    const { result, diagnostics } = await splitSqlFile("psql.sql", sql);
    expect(result.kind).toBe("opaque");
    expect(diagnostics[0]?.code).toBe("opaque-file");
  });

  test("does not treat SAVEPOINT inside a string as opaque", async () => {
    const sql = "COMMENT ON TABLE t IS 'savepoint in a comment?';";
    const { result } = await splitSqlFile("str.sql", sql);
    expect(result.kind).toBe("statements");
  });
});

describe("ingestChain", () => {
  test("preserves file order", async () => {
    const { files } = await ingestChain([
      { name: "2.sql", sql: "CREATE TABLE b (id int);" },
      { name: "1.sql", sql: "CREATE TABLE a (id int);" },
    ]);
    expect(
      files.map((f) => (f.kind === "statements" ? f.file : f.file)),
    ).toEqual(["2.sql", "1.sql"]);
  });
});

describe("readChain", () => {
  test("orders timestamp-prefixed .sql files and ignores others", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pg-squash-"));
    await writeFile(
      join(dir, "20240101120000_b.sql"),
      "CREATE TABLE b (id int);\n",
    );
    await writeFile(
      join(dir, "20240101110000_a.sql"),
      "CREATE TABLE a (id int);\n",
    );
    await writeFile(join(dir, "readme.md"), "nope");
    await writeFile(
      join(dir, "not_a_migration.sql"),
      "CREATE TABLE x (id int);\n",
    );
    await mkdir(join(dir, "nested"));
    await writeFile(
      join(dir, "nested", "20240101130000_c.sql"),
      "CREATE TABLE c (id int);\n",
    );
    const chain = await readChain(dir);
    expect(chain.map((f) => f.name)).toEqual([
      "20240101110000_a.sql",
      "20240101120000_b.sql",
    ]);
    expect(chain[0]?.sql).toContain("CREATE TABLE a");
  });
});
