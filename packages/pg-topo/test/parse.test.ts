import { describe, expect, test } from "bun:test";
import { parseSqlContent } from "../src/ingest/parse";

describe("parseSqlContent", () => {
  test("sourceOffset skips leading whitespace so statement id points to first character", async () => {
    const content = "  \n\t create table public.t(i int);";
    const result = await parseSqlContent(content, "test.sql");
    expect(result.statements.length).toBe(1);
    const stmt = result.statements[0];
    expect(stmt).toBeDefined();
    expect(stmt?.id.sourceOffset).toBeDefined();
    const offset = stmt?.id.sourceOffset ?? -1;
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(content.length);
    expect(/\s/.test(content[offset] ?? "")).toBe(false);
    expect(content.slice(offset).startsWith("create")).toBe(true);
  });

  test("reports PARSE_ERROR and empty statements when SQL is invalid", async () => {
    const content = "select * from invalid syntax {{{";
    const result = await parseSqlContent(content, "bad.sql");
    expect(result.statements).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("PARSE_ERROR");
    expect(result.diagnostics[0]?.statementId).toEqual({
      filePath: "bad.sql",
      statementIndex: 0,
    });
  });

  test("parses each input string atomically", async () => {
    const result = await parseSqlContent(
      "create table public.valid(id integer); select * from invalid syntax {{{",
      "atomic.sql",
    );

    expect(result.statements).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("PARSE_ERROR");
  });

  test("merges annotation diagnostics with statementId", async () => {
    const content = `
-- pg-topo:phase bootstrap
-- pg-topo:phase privileges
create schema app;
`;
    const result = await parseSqlContent(content, "annot.sql");
    expect(result.statements).toHaveLength(1);
    const invalidAnnotations = result.diagnostics.filter(
      (d) => d.code === "INVALID_ANNOTATION",
    );
    expect(invalidAnnotations.length).toBeGreaterThan(0);
    expect(invalidAnnotations[0]?.statementId?.filePath).toBe("annot.sql");
    expect(invalidAnnotations[0]?.statementId?.statementIndex).toBe(0);
  });
});
