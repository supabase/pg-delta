/**
 * Regressions for materialized-view formatting (PR #307 Codex review):
 *  - a quoted/qualified matview name was skipped by scanTokens, so the storage
 *    `WITH (...)` clause (and the name) were dropped (#3499812840);
 *  - with `preserveViewBodies:false` the body is unprotected, and the scanner
 *    treated every `AS`/`WITH` inside the SELECT (column alias, `WITH NO DATA`)
 *    as a matview clause, shredding the query (#3499812830).
 *
 * No Docker required (pure formatter).
 */
import { describe, expect, test } from "bun:test";
import { formatSqlStatements } from "./index.ts";

describe("materialized view formatting", () => {
  test("quoted/qualified name keeps the storage WITH clause", () => {
    const sql = `CREATE MATERIALIZED VIEW "s"."v" WITH (fillfactor = 70) AS SELECT 1`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain(`"s"."v"`);
    expect(result).toContain("fillfactor");
  });

  test("unprotected SELECT body is not shredded on AS/WITH", () => {
    const sql = `CREATE MATERIALIZED VIEW v AS SELECT 1 AS a WITH NO DATA`;
    const [result] = formatSqlStatements([sql], {
      preserveViewBodies: false,
    });
    expect(result).toContain("SELECT 1 AS a");
    expect(result).toContain("WITH NO DATA");
  });
});
