/**
 * Regressions for the `--format-options` export path (PR #307 Codex review):
 *  - rewrite-rule bodies (`DO ALSO ( …; … )`) must not be split on the
 *    semicolons inside their parentheses;
 *  - index `INCLUDE (…)` must keep its closing paren when a WHERE/WITH/
 *    TABLESPACE clause follows;
 *  - index `NULLS NOT DISTINCT` must survive when such a clause follows.
 *
 * No Docker required (pure formatter).
 */
import { describe, expect, test } from "bun:test";
import { formatSqlStatements } from "./index.ts";
import { splitSqlStatements } from "./format-utils.ts";

describe("rule body splitting", () => {
  test("a DO ALSO (…; …) rule body is not split on its inner semicolons", () => {
    const sql =
      "CREATE RULE log_insert AS ON INSERT TO public.t DO ALSO " +
      "(INSERT INTO public.log VALUES (1); UPDATE public.counts SET n = n + 1)";
    expect(splitSqlStatements(sql)).toEqual([sql]);
  });

  test("formatSqlStatements keeps a multi-command rule as one statement", () => {
    const sql =
      "CREATE RULE log_insert AS ON INSERT TO public.t DO ALSO " +
      "(INSERT INTO public.log VALUES (1); UPDATE public.counts SET n = n + 1)";
    const results = formatSqlStatements([sql]);
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("INSERT INTO public.log");
    expect(results[0]).toContain("UPDATE public.counts");
  });
});

describe("index formatting edge cases", () => {
  test("INCLUDE (...) keeps its closing paren before a WHERE clause", () => {
    const sql = "CREATE INDEX idx ON public.t (a) INCLUDE (b) WHERE (a > 0)";
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain("INCLUDE (b)");
    expect(result).toContain("WHERE");
    // the column 'b' must not leak into the WHERE clause / lose its paren
    expect(result).not.toContain("INCLUDE (b\n");
    expect(result).not.toMatch(/INCLUDE \(b\b(?!\))/);
  });

  test("NULLS NOT DISTINCT survives when a WHERE clause follows", () => {
    const sql =
      "CREATE UNIQUE INDEX idx ON public.t (a) NULLS NOT DISTINCT WHERE (a IS NOT NULL)";
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain("NULLS NOT DISTINCT");
    expect(result).toContain("WHERE");
  });
});
