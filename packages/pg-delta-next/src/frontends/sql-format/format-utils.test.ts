import { describe, expect, it } from "bun:test";
import { DEFAULT_OPTIONS } from "./constants.ts";
import {
  formatColumnList,
  formatKeyValueItems,
  formatListItems,
  indentString,
  splitLeadingComments,
  splitSqlStatements,
} from "./format-utils.ts";

describe("splitSqlStatements", () => {
  it("splits by semicolons", () => {
    const result = splitSqlStatements("SELECT 1;SELECT 2");
    expect(result).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("ignores semicolons inside quotes", () => {
    const result = splitSqlStatements("SELECT ';' FROM foo");
    expect(result).toEqual(["SELECT ';' FROM foo"]);
  });

  it("ignores semicolons inside comments", () => {
    const result = splitSqlStatements("SELECT 1 -- semi; here\nFROM foo");
    expect(result).toEqual(["SELECT 1 -- semi; here\nFROM foo"]);
  });

  it("does not split inside a BEGIN ATOMIC routine body", () => {
    // pg_get_functiondef emits SQL-standard bodies as `BEGIN ATOMIC ...; ...; END`
    // whose statement-separating semicolons are NOT inside quotes or dollar tags.
    // The body must stay one statement.
    const sql =
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql\n" +
      "BEGIN ATOMIC\n SELECT 1;\n SELECT 2;\nEND";
    expect(splitSqlStatements(sql)).toEqual([sql]);
  });

  it("treats CASE ... END inside a BEGIN ATOMIC body as part of the body", () => {
    const sql =
      "CREATE FUNCTION f(x int) RETURNS int LANGUAGE sql\n" +
      "BEGIN ATOMIC\n SELECT CASE WHEN x > 0 THEN 1 ELSE 0 END;\nEND";
    expect(splitSqlStatements(sql)).toEqual([sql]);
  });

  it("still splits a standalone statement that ends with CASE ... END", () => {
    const result = splitSqlStatements("SELECT CASE WHEN x THEN 1 END;SELECT 2");
    expect(result).toEqual(["SELECT CASE WHEN x THEN 1 END", "SELECT 2"]);
  });
});

describe("splitLeadingComments", () => {
  it("separates leading comment lines from body", () => {
    const input = "-- comment\n-- another\nSELECT 1";
    const result = splitLeadingComments(input);
    expect(result.commentLines).toEqual(["-- comment", "-- another"]);
    expect(result.body).toBe("SELECT 1");
  });

  it("returns empty commentLines when no comments", () => {
    const result = splitLeadingComments("SELECT 1");
    expect(result.commentLines).toEqual([]);
    expect(result.body).toBe("SELECT 1");
  });
});

describe("formatColumnList", () => {
  it("formats column definitions with alignment", () => {
    const content = "id integer, name text, description varchar(255)";
    const result = formatColumnList(content, DEFAULT_OPTIONS);
    expect(result).not.toBeNull();
    expect(result?.length).toBe(3);
    // Each line should be indented
    for (const line of result ?? []) {
      expect(line).toMatch(/^\s+/);
    }
  });

  it("returns null for empty content", () => {
    expect(formatColumnList("", DEFAULT_OPTIONS)).toBeNull();
  });
});

describe("formatKeyValueItems", () => {
  it("formats key=value items with alignment", () => {
    const items = ["a = 1", "long_key = 2"];
    const result = formatKeyValueItems(items, DEFAULT_OPTIONS);
    expect(result.length).toBe(2);
    // Both should be indented
    for (const line of result) {
      expect(line).toMatch(/^\s+/);
    }
  });
});

describe("formatListItems", () => {
  it("applies trailing comma style", () => {
    const result = formatListItems(["a", "b", "c"], "  ", "trailing");
    expect(result).toEqual(["  a,", "  b,", "  c"]);
  });

  it("applies leading comma style", () => {
    const result = formatListItems(["a", "b", "c"], "  ", "leading");
    expect(result).toEqual(["    a", "  , b", "  , c"]);
  });
});

describe("indentString", () => {
  it("returns correct number of spaces", () => {
    expect(indentString(0)).toBe("");
    expect(indentString(2)).toBe("  ");
    expect(indentString(4)).toBe("    ");
  });
});
