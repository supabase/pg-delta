import { describe, expect, it } from "bun:test";
import { findTopLevelParen, scanTokens, splitByCommas } from "./tokenizer.ts";

describe("scanTokens", () => {
  it("extracts word tokens with positions and upper-cased values", () => {
    const tokens = scanTokens("CREATE TABLE foo");
    expect(tokens).toEqual([
      { value: "CREATE", upper: "CREATE", start: 0, end: 6, depth: 0 },
      { value: "TABLE", upper: "TABLE", start: 7, end: 12, depth: 0 },
      { value: "foo", upper: "FOO", start: 13, end: 16, depth: 0 },
    ]);
  });

  it("tracks depth for tokens inside parentheses", () => {
    const tokens = scanTokens("fn(a, b)");
    const inner = tokens.filter((t) => t.depth > 0);
    expect(inner.length).toBe(2);
    expect(inner[0].value).toBe("a");
    expect(inner[0].depth).toBe(1);
    expect(inner[1].value).toBe("b");
    expect(inner[1].depth).toBe(1);
  });

  it("emits a single token for a double-quoted identifier", () => {
    const tokens = scanTokens('CREATE TRIGGER "send-chat-push" AFTER');
    expect(tokens).toEqual([
      { value: "CREATE", upper: "CREATE", start: 0, end: 6, depth: 0 },
      { value: "TRIGGER", upper: "TRIGGER", start: 7, end: 14, depth: 0 },
      {
        value: '"send-chat-push"',
        upper: '"SEND-CHAT-PUSH"',
        start: 15,
        end: 31,
        depth: 0,
      },
      { value: "AFTER", upper: "AFTER", start: 32, end: 37, depth: 0 },
    ]);
  });

  it("ignores content in quotes, comments, and dollar-quotes", () => {
    const tokens = scanTokens("SELECT 'hello' -- comment\n FROM $$body$$ tbl");
    const uppers = tokens.map((t) => t.upper);
    expect(uppers).toContain("SELECT");
    expect(uppers).toContain("FROM");
    expect(uppers).toContain("TBL");
    expect(uppers).not.toContain("HELLO");
    expect(uppers).not.toContain("COMMENT");
    expect(uppers).not.toContain("BODY");
  });
});

describe("findTopLevelParen", () => {
  it("finds matching () at depth 0", () => {
    const result = findTopLevelParen("CREATE TABLE foo (a int)", 0);
    expect(result).toEqual({ open: 17, close: 23 });
  });

  it("skips nested parentheses", () => {
    const result = findTopLevelParen("fn((a, b), c)", 0);
    expect(result).toEqual({ open: 2, close: 12 });
  });

  it("returns null when no match found", () => {
    const result = findTopLevelParen("no parens here", 0);
    expect(result).toBeNull();
  });
});

describe("splitByCommas", () => {
  it("splits basic comma-separated items", () => {
    const items = splitByCommas("a, b, c");
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("preserves commas inside parentheses", () => {
    const items = splitByCommas("a, fn(b, c), d");
    expect(items).toEqual(["a", "fn(b, c)", "d"]);
  });

  it("preserves commas inside quotes", () => {
    const items = splitByCommas("a, 'b,c', d");
    expect(items).toEqual(["a", "'b,c'", "d"]);
  });
});
