/**
 * Regressions for the `--format-options` export path (PR #307 Codex review):
 * a schema-qualified user type whose final component is a non-reserved keyword
 * (e.g. `public.cost`, `public.generated`) was mis-read as a clause / boundary
 * keyword, so the formatter split the type name and produced invalid SQL. A
 * keyword that is the tail of a qualified name (preceded by `.`) is an
 * identifier, not a keyword.
 *
 * No Docker required (pure formatter).
 */
import { describe, expect, test } from "bun:test";
import { formatSqlStatements } from "./index.ts";

describe("keyword-like qualified type names survive formatting", () => {
  test("function RETURNS public.cost is not split on the COST keyword", () => {
    const sql =
      `CREATE FUNCTION public.f() RETURNS public.cost ` +
      `LANGUAGE sql COST 100 AS $function$SELECT NULL::public.cost$function$`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain("public.cost");
    expect(result).not.toMatch(/RETURNS\s+public\.\s*$/m);
  });

  test("table column of type public.generated keeps the type name", () => {
    const sql = `CREATE TABLE public.t (\n  a integer,\n  b public.generated NOT NULL\n)`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toContain("public.generated");
    expect(result).not.toMatch(/public\.\s+GENERATED/);
  });
});
