import { describe, expect, test } from "bun:test";
import { formatSqlStatements } from "./index.ts";
import { scanTokens } from "./tokenizer.ts";

function extractCommentLiteral(statement: string): string {
  const tokens = scanTokens(statement);
  const isToken = tokens.find(
    (token) => token.depth === 0 && token.upper === "IS",
  );
  if (!isToken) {
    throw new Error(`No IS token found in statement:\n${statement}`);
  }

  let literalStart = isToken.end;
  while (
    literalStart < statement.length &&
    /\s/.test(statement[literalStart]!)
  ) {
    literalStart += 1;
  }

  const first = statement[literalStart];
  let quoteStart = -1;
  if (first === "'") {
    quoteStart = literalStart;
  } else if (
    (first === "E" || first === "e") &&
    statement[literalStart + 1] === "'"
  ) {
    quoteStart = literalStart + 1;
  } else if (
    (first === "U" || first === "u") &&
    statement[literalStart + 1] === "&" &&
    statement[literalStart + 2] === "'"
  ) {
    quoteStart = literalStart + 2;
  } else {
    throw new Error(`No comment literal found in statement:\n${statement}`);
  }

  let cursor = quoteStart + 1;
  while (cursor < statement.length) {
    if (statement[cursor] === "'") {
      if (statement[cursor + 1] === "'") {
        cursor += 2;
        continue;
      }
      return statement.slice(literalStart, cursor + 1);
    }
    cursor += 1;
  }

  throw new Error(`Unterminated comment literal in statement:\n${statement}`);
}

describe("comment literal formatting", () => {
  test("preserves multiline COMMENT payloads exactly while wrapping SQL around them", () => {
    const sqlStatements = [
      `COMMENT ON FUNCTION auth.can_project(bigint,bigint,text,auth.action,json,uuid) IS '
Enhanced wrapper method for the primary auth.can() function. Utilize this wrapper to specifically check for project-related permissions.
';`,
      `COMMENT ON FUNCTION auth.can_project(bigint,text,auth.action,json,uuid) IS '
Enhanced wrapper method for the primary auth.can() function. Utilize this wrapper to specifically check for project-related permissions.
This method does not require _organization_id parameter.
';`,
      `COMMENT ON FUNCTION auth.can(bigint,text,auth.action,json,uuid) IS '
Enhanced wrapper method for the primary auth.can() function. With the introduction of the _project_id parameter into auth.can(),
this wrapper guarantees the seamless operation of all existing auth.can() checks.
';`,
    ];

    const [first, second, third] = formatSqlStatements(sqlStatements, {
      maxWidth: 80,
    });

    expect(extractCommentLiteral(first!)).toMatchInlineSnapshot(`
      "'
      Enhanced wrapper method for the primary auth.can() function. Utilize this wrapper to specifically check for project-related permissions.
      '"
    `);

    expect(extractCommentLiteral(second!)).toMatchInlineSnapshot(`
      "'
      Enhanced wrapper method for the primary auth.can() function. Utilize this wrapper to specifically check for project-related permissions.
      This method does not require _organization_id parameter.
      '"
    `);

    expect(extractCommentLiteral(third!)).toMatchInlineSnapshot(`
      "'
      Enhanced wrapper method for the primary auth.can() function. With the introduction of the _project_id parameter into auth.can(),
      this wrapper guarantees the seamless operation of all existing auth.can() checks.
      '"
    `);
  });
});
