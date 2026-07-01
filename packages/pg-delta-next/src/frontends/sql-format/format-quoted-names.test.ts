/**
 * Regressions for the `--format-options` export path (PR #307 Codex review):
 * the catalog renderer double-quotes object names, but `scanTokens` skips
 * double-quoted identifiers, so positional `tokens[N]` indexing landed PAST the
 * name onto the first clause keyword — and the formatter then dropped the clause
 * that followed the name, producing invalid SQL. Each formatter must locate the
 * (quoted) name from the raw statement before slicing clauses.
 *
 * No Docker required (pure formatter).
 */
import { describe, expect, test } from "bun:test";
import { formatSqlStatements } from "./index.ts";

describe("formatting preserves clauses after a quoted object name", () => {
  test("trigger keeps its event/table clause", () => {
    const sql =
      `CREATE TRIGGER "tr" AFTER INSERT ON "public"."t" ` +
      `FOR EACH ROW EXECUTE FUNCTION "public"."f"()`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain("AFTER INSERT ON");
    expect(result).toContain(`"public"."t"`);
    expect(result).toContain("EXECUTE FUNCTION");
  });

  test("foreign server keeps FOREIGN DATA WRAPPER", () => {
    const sql =
      `CREATE SERVER "srv" FOREIGN DATA WRAPPER "postgres_fdw" ` +
      `OPTIONS (host 'h', dbname 'd')`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain(`FOREIGN DATA WRAPPER "postgres_fdw"`);
    expect(result).toContain("OPTIONS");
  });

  test("foreign server keeps an unquoted keyword-like FDW name (e.g. options)", () => {
    // the FDW name `options` is an unquoted non-reserved keyword; it must not be
    // mistaken for an OPTIONS clause start (which would drop the wrapper name).
    const sql = `CREATE SERVER srv FOREIGN DATA WRAPPER options OPTIONS (host 'h')`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain("FOREIGN DATA WRAPPER options");
    expect(result).not.toContain('"AS');
    // still exactly one OPTIONS clause (the real one), name not swallowed
    expect(result).toContain("OPTIONS");
    expect(result).toContain("host 'h'");
  });

  test("subscription keeps CONNECTION conninfo", () => {
    const sql =
      `CREATE SUBSCRIPTION "sub" CONNECTION 'host=h dbname=d' ` +
      `PUBLICATION "pub" WITH (connect = false)`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain("CONNECTION 'host=h dbname=d'");
    expect(result).toContain(`PUBLICATION "pub"`);
  });

  test("foreign-data wrapper keeps its HANDLER/OPTIONS clauses", () => {
    const sql = `CREATE FOREIGN DATA WRAPPER "w" OPTIONS (debug 'true')`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain("OPTIONS");
    expect(result).toContain("debug");
  });

  test("language keeps its HANDLER clause", () => {
    const sql = `CREATE LANGUAGE "plx" HANDLER "public"."plx_handler"`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain(`HANDLER "public"."plx_handler"`);
  });
});
