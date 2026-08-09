import { describe, expect, it } from "bun:test";
import { DEFAULT_OPTIONS } from "./constants.ts";
import type { NormalizedOptions } from "./types.ts";
import { wrapStatement } from "./wrap.ts";

const opts: NormalizedOptions = { ...DEFAULT_OPTIONS, maxWidth: 40 };
const noWrap = new Set<string>();

describe("wrapStatement", () => {
  it("keeps short lines unwrapped", () => {
    const result = wrapStatement("SELECT 1", opts, noWrap);
    expect(result).toBe("SELECT 1");
  });

  it("wraps long lines at whitespace before maxWidth", () => {
    const long = "SELECT column_a, column_b, column_c, column_d FROM my_table";
    const result = wrapStatement(long, opts, noWrap);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]!.length).toBeLessThanOrEqual(40);
  });

  it("does not wrap comment lines regardless of length", () => {
    const comment =
      "-- this is a very long comment that exceeds the maximum line width significantly";
    const result = wrapStatement(comment, opts, noWrap);
    expect(result).toBe(comment);
  });

  it("does not wrap lines containing noWrap placeholders", () => {
    const placeholder = "__PGDELTA_PLACEHOLDER_0__";
    const noWrapSet = new Set([placeholder]);
    const long = `CREATE FUNCTION foo() ${placeholder}`;
    const result = wrapStatement(long, { ...opts, maxWidth: 20 }, noWrapSet);
    expect(result.split("\n").length).toBe(1);
  });

  it("adds proper continuation indentation", () => {
    const long = "SELECT column_a, column_b, column_c, column_d FROM my_table";
    const result = wrapStatement(long, opts, noWrap);
    const lines = result.split("\n");
    if (lines.length > 1) {
      expect(lines[1]).toMatch(/^\s+/);
    }
  });

  it("prefers breaking before SQL keywords over arbitrary whitespace", () => {
    // With maxWidth=60, the line must wrap. The keyword-aware logic should prefer
    // to break before MATCH, FOREIGN, CHECK, ON, etc. rather than at any space.
    const line =
      "ADD CONSTRAINT fk_ref FOREIGN KEY (ref_id) REFERENCES tbl(id) MATCH FULL ON DELETE CASCADE";
    const result = wrapStatement(line, { ...opts, maxWidth: 70 }, noWrap);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // The second line should start with a keyword like MATCH or ON
    const secondLineTrimmed = lines[1]!.trim();
    expect(secondLineTrimmed).toMatch(
      /^(MATCH|ON|FOREIGN|CHECK|REFERENCES|DEFERRABLE|INITIALLY)/,
    );
  });

  it("falls back to whitespace when no keyword boundary found", () => {
    const line =
      "this_is_a very_long_line that_has no_sql_keywords at_all_inside";
    const result = wrapStatement(line, { ...opts, maxWidth: 30 }, noWrap);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("does not break between CREATE and PUBLICATION", () => {
    const line =
      "CREATE PUBLICATION pub_custom FOR TABLE public.articles_with_a_very_long_name (id, title) WHERE (published = true)";
    const result = wrapStatement(line, { ...opts, maxWidth: 70 }, noWrap);
    const lines = result.split("\n");
    expect(lines[0]).toContain("CREATE PUBLICATION");
    expect(lines[0]).not.toBe("CREATE");
  });

  it("does not break between COMMENT and ON", () => {
    const line =
      "COMMENT ON FUNCTION public.calculate_metrics(text,text,integer) IS 'Calculate metrics for a given table'";
    const result = wrapStatement(line, { ...opts, maxWidth: 60 }, noWrap);
    const lines = result.split("\n");
    expect(lines[0]).toContain("COMMENT ON");
    expect(lines[0]).not.toBe("COMMENT");
  });

  it("does not break between GRANT/REVOKE ALL and ON", () => {
    const line =
      "GRANT ALL ON FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name(text, text, integer) TO app_user";
    const result = wrapStatement(line, { ...opts, maxWidth: 60 }, noWrap);
    const lines = result.split("\n");
    expect(lines[0]).toContain("GRANT ALL ON");
    expect(lines[0]).not.toBe("GRANT ALL");
  });

  it("never produces blank lines from breaking within leading indent", () => {
    // Simulate a continuation line starting with "  ON ..." — should not break before ON within the indent
    const line =
      "  ON FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name(text,text,integer) IS 'Calculate metrics'";
    const result = wrapStatement(line, { ...opts, maxWidth: 60 }, noWrap);
    const lines = result.split("\n");
    // No line should be empty (the blank-line bug)
    for (const l of lines) {
      expect(l.trim().length).toBeGreaterThan(0);
    }
    // First line should keep "ON FUNCTION" together
    expect(lines[0]!.trim()).toMatch(/^ON FUNCTION/);
  });

  it("breaks after commas when within maxWidth (one clause per line)", () => {
    // No parentheses: "a, b" with narrow width breaks after the comma
    const result = wrapStatement("a, b", { ...opts, maxWidth: 3 }, noWrap);
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]!.trimEnd()).toBe("a,");
    expect(lines[1]!.trim()).toBe("b");
  });
});
