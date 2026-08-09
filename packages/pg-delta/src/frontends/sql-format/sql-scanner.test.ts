import { describe, expect, it } from "bun:test";
import {
  isEscapeStringQuoteStart,
  isWordChar,
  readDollarTag,
  walkSql,
} from "./sql-scanner.ts";

describe("isWordChar", () => {
  it("returns true for letters, digits, and underscore", () => {
    for (const ch of ["a", "z", "A", "Z", "0", "9", "_"]) {
      expect(isWordChar(ch)).toBe(true);
    }
  });

  it("returns false for spaces, parens, and symbols", () => {
    for (const ch of [" ", "(", ")", ",", ";", ".", "-", "+"]) {
      expect(isWordChar(ch)).toBe(false);
    }
  });
});

describe("readDollarTag", () => {
  it("reads $$ tag", () => {
    expect(readDollarTag("$$body$$", 0)).toMatchInlineSnapshot(`"$$"`);
  });

  it("reads named tag like $fn$", () => {
    expect(readDollarTag("$fn$body$fn$", 0)).toMatchInlineSnapshot(`"$fn$"`);
  });

  it("reads $body$ tag", () => {
    expect(readDollarTag("$body$content$body$", 0)).toMatchInlineSnapshot(
      `"$body$"`,
    );
  });

  it("returns null for non-tag like $1+2", () => {
    expect(readDollarTag("$1+2", 0)).toBeNull();
  });

  it("returns null when closing $ is missing", () => {
    expect(readDollarTag("$abc", 0)).toBeNull();
  });

  it("returns null when char at start is not $", () => {
    expect(readDollarTag("abc", 0)).toBeNull();
  });
});

describe("isEscapeStringQuoteStart", () => {
  it("detects E escape-string prefix", () => {
    expect(isEscapeStringQuoteStart("E'abc'", 1)).toBe(true);
    expect(isEscapeStringQuoteStart("e'abc'", 1)).toBe(true);
  });

  it("does not treat U& strings as escape strings", () => {
    expect(isEscapeStringQuoteStart("U&'abc'", 2)).toBe(false);
    expect(isEscapeStringQuoteStart("u&'abc'", 2)).toBe(false);
  });

  it("does not treat plain strings as escape strings", () => {
    expect(isEscapeStringQuoteStart("'abc'", 0)).toBe(false);
    expect(isEscapeStringQuoteStart("fooe'abc'", 4)).toBe(false);
  });
});

describe("walkSql", () => {
  it("skips single-quoted strings", () => {
    const chars: string[] = [];
    walkSql("a 'hello' b", (_, char) => {
      chars.push(char);
      return true;
    });
    expect(chars.join("")).toMatchInlineSnapshot(`"a  b"`);
  });

  it("skips single-quoted strings with '' escapes", () => {
    const chars: string[] = [];
    walkSql("a 'it''s' b", (_, char) => {
      chars.push(char);
      return true;
    });
    expect(chars.join("")).toMatchInlineSnapshot(`"a  b"`);
  });

  it("skips E strings with backslash-escaped quotes", () => {
    const chars: string[] = [];
    walkSql("a E'it\\'s still quoted' b", (_, char) => {
      chars.push(char);
      return true;
    });
    expect(chars.join("")).toMatchInlineSnapshot(`"a E b"`);
  });

  it("skips U& strings using standard '' quoting (no backslash escaping)", () => {
    const chars: string[] = [];
    walkSql("a U&'it''s ok' b", (_, char) => {
      chars.push(char);
      return true;
    });
    expect(chars.join("")).toMatchInlineSnapshot(`"a U& b"`);
  });

  it("skips double-quoted identifiers", () => {
    const chars: string[] = [];
    walkSql('a "col" b', (_, char) => {
      chars.push(char);
      return true;
    });
    expect(chars.join("")).toMatchInlineSnapshot(`"a  b"`);
  });

  it('skips double-quoted identifiers with "" escapes', () => {
    const chars: string[] = [];
    walkSql('a "col""name" b', (_, char) => {
      chars.push(char);
      return true;
    });
    expect(chars.join("")).toMatchInlineSnapshot(`"a  b"`);
  });

  it("skips line comments", () => {
    const chars: string[] = [];
    walkSql("a -- comment\nb", (_, char) => {
      chars.push(char);
      return true;
    });
    expect(chars.join("")).toMatchInlineSnapshot(`"a b"`);
  });

  it("skips block comments", () => {
    const chars: string[] = [];
    walkSql("a /* block */ b", (_, char) => {
      chars.push(char);
      return true;
    });
    expect(chars.join("")).toMatchInlineSnapshot(`"a  b"`);
  });

  it("skips dollar-quoted blocks", () => {
    const chars: string[] = [];
    walkSql("a $$body$$ b", (_, char) => {
      chars.push(char);
      return true;
    });
    expect(chars.join("")).toMatchInlineSnapshot(`"a  b"`);
  });

  it("tracks parenthesis depth correctly", () => {
    const depths: [string, number][] = [];
    walkSql(
      "a(b(c)d)e",
      (_, char, depth) => {
        depths.push([char, depth]);
        return true;
      },
      { trackDepth: true },
    );
    expect(depths).toMatchInlineSnapshot(`
      [
        [
          "a",
          0,
        ],
        [
          "(",
          0,
        ],
        [
          "b",
          1,
        ],
        [
          "(",
          1,
        ],
        [
          "c",
          2,
        ],
        [
          ")",
          1,
        ],
        [
          "d",
          1,
        ],
        [
          ")",
          0,
        ],
        [
          "e",
          0,
        ],
      ]
    `);
  });

  it("respects startIndex option", () => {
    const chars: string[] = [];
    walkSql(
      "abcde",
      (_, char) => {
        chars.push(char);
        return true;
      },
      { startIndex: 2 },
    );
    expect(chars.join("")).toMatchInlineSnapshot(`"cde"`);
  });

  it("calls onSkipped for skipped content", () => {
    const skipped: string[] = [];
    walkSql("a 'x' b", () => true, {
      onSkipped: (chunk) => {
        skipped.push(chunk);
      },
    });
    expect(skipped).toMatchInlineSnapshot(`
      [
        "'",
        "x",
        "'",
      ]
    `);
  });

  it("stops early when callback returns false", () => {
    const chars: string[] = [];
    walkSql("abcde", (_, char) => {
      chars.push(char);
      if (char === "c") return false;
      return true;
    });
    expect(chars.join("")).toMatchInlineSnapshot(`"abc"`);
  });
});
