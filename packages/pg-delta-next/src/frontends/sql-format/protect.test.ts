import { describe, expect, it } from "bun:test";
import { DEFAULT_OPTIONS } from "./constants.ts";
import { protectSegments, restorePlaceholders } from "./protect.ts";

describe("protectSegments", () => {
  it("protects function body after AS", () => {
    const sql = "CREATE FUNCTION foo() RETURNS void AS $$ BEGIN NULL; END; $$";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    expect(result.text).toContain("__PGDELTA_PLACEHOLDER_");
    expect(result.text).not.toContain("BEGIN NULL");
    expect(result.placeholders.size).toBeGreaterThan(0);
    expect(result.skipCasing).toBe(false);
  });

  it("protects view body after AS", () => {
    const sql = "CREATE VIEW v AS SELECT 1";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    expect(result.text).toContain("__PGDELTA_PLACEHOLDER_");
    expect(result.text).not.toContain("SELECT 1");
  });

  it("protects standalone dollar-quoted blocks", () => {
    const sql = "SELECT $$hello world$$";
    const result = protectSegments(sql, {
      ...DEFAULT_OPTIONS,
      preserveRoutineBodies: false,
      preserveViewBodies: false,
      preserveRuleBodies: false,
    });
    expect(result.text).toContain("__PGDELTA_PLACEHOLDER_");
    expect(result.text).not.toContain("hello world");
  });

  it("protects COMMENT literal payloads and restores multiline text exactly", () => {
    const sql = `COMMENT ON FUNCTION auth.can_project(bigint,bigint,text,auth.action,json,uuid) IS '
Enhanced wrapper method for the primary auth.can() function. Utilize this wrapper to specifically check for project-related permissions.
';`;
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    expect(result.text).toContain("__PGDELTA_PLACEHOLDER_");
    expect(result.text).not.toContain(
      "Enhanced wrapper method for the primary auth.can() function.",
    );
    const restored = restorePlaceholders(result.text, result.placeholders);
    expect(restored).toBe(sql);
  });

  it("preserves escaped quotes inside COMMENT literal payloads", () => {
    const sql =
      "COMMENT ON FUNCTION public.fn() IS E'it''s an ''exact'' payload';";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    expect(result.text).toContain("__PGDELTA_PLACEHOLDER_");
    const restored = restorePlaceholders(result.text, result.placeholders);
    expect(restored).toBe(sql);
  });

  it("preserves backslash-escaped quotes in E strings", () => {
    const sql = "COMMENT ON FUNCTION public.fn() IS E'keep \\'quote\\' exact';";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    expect(result.text).toContain("__PGDELTA_PLACEHOLDER_");
    const restored = restorePlaceholders(result.text, result.placeholders);
    expect(restored).toBe(sql);
    expect(result.skipCasing).toBe(false);
  });

  it("preserves U& strings using standard '' quoting (no backslash escaping)", () => {
    const sql = "COMMENT ON FUNCTION public.fn() IS U&'keep ''quote'' exact';";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    expect(result.text).toContain("__PGDELTA_PLACEHOLDER_");
    const restored = restorePlaceholders(result.text, result.placeholders);
    expect(restored).toBe(sql);
    expect(result.skipCasing).toBe(false);
  });

  it("flags malformed escape-string comments as unsafe for post-processing", () => {
    const sql = "COMMENT ON FUNCTION public.fn() IS E'unterminated \\'";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    expect(result.text).toBe(sql);
    expect(result.placeholders.size).toBe(0);
    expect(result.skipCasing).toBe(true);
  });

  it("flags unterminated dollar-quoted content as unsafe for post-processing", () => {
    const sql = "CREATE FUNCTION public.fn() RETURNS text AS $fn$select 1";
    const result = protectSegments(sql, {
      ...DEFAULT_OPTIONS,
      preserveRoutineBodies: false,
      preserveViewBodies: false,
      preserveRuleBodies: false,
    });
    expect(result.skipCasing).toBe(true);
  });

  it("does not protect COMMENT ... IS NULL", () => {
    const sql = "COMMENT ON FUNCTION public.fn() IS NULL;";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    expect(result.placeholders.size).toBe(0);
    expect(result.text).toBe(sql);
  });
});

describe("restorePlaceholders", () => {
  it("restores placeholders to original values", () => {
    const placeholders = new Map<string, string>();
    placeholders.set("__PGDELTA_PLACEHOLDER_0__", "AS $$ body $$");
    const text = "CREATE FUNCTION foo() __PGDELTA_PLACEHOLDER_0__";
    const restored = restorePlaceholders(text, placeholders);
    expect(restored).toMatchInlineSnapshot(
      `"CREATE FUNCTION foo() AS $$ body $$"`,
    );
  });

  it("correctly handles $ characters in restored values", () => {
    const placeholders = new Map<string, string>();
    placeholders.set("__PGDELTA_PLACEHOLDER_0__", "$$price$$");
    const text = "SELECT __PGDELTA_PLACEHOLDER_0__";
    const restored = restorePlaceholders(text, placeholders);
    expect(restored).toMatchInlineSnapshot(`"SELECT $$price$$"`);
  });

  it("round-trips protect → restore to produce original text", () => {
    const sql =
      "CREATE FUNCTION add(a int, b int) RETURNS int AS $$ BEGIN RETURN a + b; END; $$ LANGUAGE plpgsql";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    const restored = restorePlaceholders(result.text, result.placeholders);
    expect(restored).toBe(sql);
  });
});
