import { describe, expect, test } from "bun:test";
import {
  compactSqlExcerpt,
  formatAssistLocation,
  formatReorderOnFailureMessage,
  formatSessionPollutionMessage,
  readLoadAssistFailures,
  toLoadAssistContext,
} from "./load-assist.ts";

describe("load-assist formatters", () => {
  test("statement-kind names the move and says loadOrder cannot fix it", () => {
    const message = formatReorderOnFailureMessage("statement-kind", [
      {
        file: "01_mixed.sql",
        line: 1,
        excerpt: "ALTER PUBLICATION p ADD TABLE public.t;",
        error: 'relation "t" does not exist',
        after: {
          file: "01_mixed.sql",
          line: 2,
          excerpt: "CREATE TABLE public.t (id integer);",
        },
      },
    ]);
    expect(message).toMatchInlineSnapshot(`
      "Default load order stuck; reordered (statement-kind).
        move 01_mixed.sql:1 ALTER PUBLICATION p ADD TABLE public.t;
        after 01_mixed.sql:2 CREATE TABLE public.t (id integer);
      loadOrder cannot fix same-file order — edit or split the file."
    `);
  });

  test("cross-file after recommends loadOrder, not a same-file edit", () => {
    const message = formatReorderOnFailureMessage("statement-kind", [
      {
        file: "_cluster/publications.sql",
        line: 1,
        excerpt: "ALTER PUBLICATION p ADD TABLE public.t;",
        after: {
          file: "public/tables/t.sql",
          line: 1,
          excerpt: "CREATE TABLE public.t (id integer);",
        },
      },
    ]);
    expect(message).toMatchInlineSnapshot(`
      "Default load order stuck; reordered (statement-kind).
        stuck _cluster/publications.sql:1 ALTER PUBLICATION p ADD TABLE public.t;
        after public/tables/t.sql:1 CREATE TABLE public.t (id integer);
      Set loadOrder on .pgdelta-export.json to put public/tables/t.sql before _cluster/publications.sql."
    `);
  });

  test("file-kind lists stuck location and a concrete loadOrder", () => {
    const message = formatReorderOnFailureMessage(
      "file-kind",
      [
        {
          file: "_cluster/publications.sql",
          line: 1,
          excerpt: "ALTER PUBLICATION p ADD TABLE public.t;",
          after: {
            file: "public/tables/t.sql",
            line: 1,
            excerpt: "CREATE TABLE public.t (id integer);",
          },
        },
      ],
      ["public/tables/t.sql", "_cluster/publications.sql"],
    );
    expect(message).toMatchInlineSnapshot(`
      "Default load order stuck; reordered (file-kind).
        stuck _cluster/publications.sql:1 ALTER PUBLICATION p ADD TABLE public.t;
        after public/tables/t.sql:1 CREATE TABLE public.t (id integer);
      Set loadOrder on .pgdelta-export.json: public/tables/t.sql, _cluster/publications.sql."
    `);
  });

  test("session poisoning names the stuck statement and the earlier SET", () => {
    const message = formatSessionPollutionMessage(
      [
        {
          file: "01_table.sql",
          line: 1,
          excerpt: "CREATE TABLE locked.t (id integer);",
          error: "permission denied for schema locked",
        },
      ],
      [{ file: "00_set.sql", line: 1, excerpt: "SET ROLE load_weak;" }],
    );
    expect(message).toMatchInlineSnapshot(`
      "New connection unblocked a stuck load (session poisoning).
        stuck 01_table.sql:1 CREATE TABLE locked.t (id integer); (permission denied for schema locked)
        earlier 00_set.sql:1 SET ROLE load_weak;
      Remove session-setting statements from declarative SQL, or do not share that session with later DDL."
    `);
  });

  test("toLoadAssistContext keeps after and error for callers", () => {
    const context = toLoadAssistContext(
      [
        {
          file: "mixed.sql",
          line: 1,
          excerpt: "ALTER PUBLICATION p ADD TABLE public.t;",
          error: 'relation "t" does not exist',
          after: {
            file: "mixed.sql",
            line: 2,
            excerpt: "CREATE TABLE public.t;",
          },
        },
      ],
      { kind: "statement-kind" },
    );
    expect(context).toMatchInlineSnapshot(`
      {
        "failures": [
          {
            "after": {
              "excerpt": "CREATE TABLE public.t;",
              "file": "mixed.sql",
              "line": 2,
            },
            "error": "relation "t" does not exist",
            "excerpt": "ALTER PUBLICATION p ADD TABLE public.t;",
            "file": "mixed.sql",
            "line": 1,
          },
        ],
        "files": [
          "mixed.sql",
        ],
        "kind": "statement-kind",
      }
    `);
    const roundTrip = readLoadAssistFailures(context["failures"]);
    expect(roundTrip[0]?.after?.line).toBe(2);
    expect(roundTrip[0]?.error).toContain("does not exist");
  });

  test("formatAssistLocation omits an invented line", () => {
    expect(
      formatAssistLocation({ file: "a.sql", excerpt: "CREATE TABLE t;" }),
    ).toBe("a.sql CREATE TABLE t;");
    expect(compactSqlExcerpt("CREATE   TABLE  t;")).toBe("CREATE TABLE t;");
  });
});
