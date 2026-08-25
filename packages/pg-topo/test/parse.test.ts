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

  // Regression for supabase/pg-toolbelt#369: stmt_location/stmt_len are UTF-8
  // byte offsets, but statements were sliced with UTF-16 string indices. Any
  // non-ASCII content misaligned the slice, silently swapping the authored
  // text for a deparse that renders COMMENT ON TRIGGER/POLICY/RULE targets as
  // the invalid dotted form (`COMMENT ON TRIGGER public.t.tr`).
  describe("statement text with non-ASCII content (#369)", () => {
    test("carries COMMENT ON TRIGGER verbatim", async () => {
      const content = "COMMENT ON TRIGGER tr ON public.t IS '→→→';";
      const result = await parseSqlContent(content, "trigger.sql");
      expect(result.diagnostics).toHaveLength(0);
      expect(result.statements).toHaveLength(1);
      expect(result.statements[0]?.sql).toBe(content);
    });

    test("carries COMMENT ON POLICY verbatim", async () => {
      const content = "COMMENT ON POLICY p ON public.t IS '→→→';";
      const result = await parseSqlContent(content, "policy.sql");
      expect(result.diagnostics).toHaveLength(0);
      expect(result.statements).toHaveLength(1);
      expect(result.statements[0]?.sql).toBe(content);
    });

    test("carries COMMENT ON RULE verbatim", async () => {
      const content = "COMMENT ON RULE r ON public.t IS '→→→';";
      const result = await parseSqlContent(content, "rule.sql");
      expect(result.diagnostics).toHaveLength(0);
      expect(result.statements).toHaveLength(1);
      expect(result.statements[0]?.sql).toBe(content);
    });

    test("slices statements after a non-ASCII statement verbatim", async () => {
      const first = "comment on table public.t is '→→→';";
      const second = "create table public.u(id int);";
      const result = await parseSqlContent(
        `${first}\n${second}\n`,
        "drift.sql",
      );
      expect(result.diagnostics).toHaveLength(0);
      expect(result.statements).toHaveLength(2);
      expect(result.statements[0]?.sql).toBe(first);
      expect(result.statements[1]?.sql).toBe(second);
    });

    test("sourceOffset is a character offset even after non-ASCII content", async () => {
      const content =
        "comment on table public.t is '→→→';\ncreate table public.u(id int);\n";
      const result = await parseSqlContent(content, "offsets.sql");
      expect(result.statements).toHaveLength(2);
      const offset = result.statements[1]?.id.sourceOffset ?? -1;
      expect(content.slice(offset).startsWith("create table public.u")).toBe(
        true,
      );
    });

    test("sourceOffsets stay exact across many statements with non-ASCII content", async () => {
      const statements = [
        "comment on table public.a is '→';",
        "create table public.b(id int);",
        "comment on table public.b is '→→';",
        "create table public.c(id int);",
      ];
      const content = statements.join("\n");
      const result = await parseSqlContent(content, "many.sql");
      expect(result.statements).toHaveLength(statements.length);
      for (const [index, statement] of statements.entries()) {
        const offset = result.statements[index]?.id.sourceOffset ?? -1;
        expect(content.slice(offset, offset + statement.length)).toBe(
          statement,
        );
      }
    });

    test("slices COMMENT ON TRIGGER after a non-ASCII file-header comment", async () => {
      const comment = "COMMENT ON TRIGGER tr ON public.t IS '→→→';";
      const content = `-- café header\n${comment}`;
      const result = await parseSqlContent(content, "preamble.sql");
      expect(result.diagnostics).toHaveLength(0);
      expect(result.statements).toHaveLength(1);
      expect(result.statements[0]?.sql).toBe(comment);
      const offset = result.statements[0]?.id.sourceOffset ?? -1;
      expect(content.slice(offset).startsWith("COMMENT ON TRIGGER")).toBe(true);
    });
  });

  describe("leading file and mid-file trivia", () => {
    test("does not glue a file-header line comment onto statement 0", async () => {
      const content = `-- write revoke SQL
alter default privileges for role postgres in schema public
  revoke select on tables from anon;`;
      const result = await parseSqlContent(content, "header.sql");
      expect(result.diagnostics).toHaveLength(0);
      expect(result.statements).toHaveLength(1);
      const sql = result.statements[0]?.sql ?? "";
      expect(sql.toLowerCase().startsWith("-- write")).toBe(false);
      expect(sql.toLowerCase().startsWith("alter default privileges")).toBe(
        true,
      );
      const offset = result.statements[0]?.id.sourceOffset ?? -1;
      expect(content.slice(offset).toLowerCase().startsWith("alter")).toBe(
        true,
      );
    });

    test("does not glue a file-header block comment onto statement 0", async () => {
      const content = `/* migrations-new stub */
create schema app;`;
      const result = await parseSqlContent(content, "block.sql");
      expect(result.statements).toHaveLength(1);
      const sql = result.statements[0]?.sql ?? "";
      expect(sql).not.toContain("migrations-new");
      expect(sql.toLowerCase().startsWith("create schema")).toBe(true);
      const offset = result.statements[0]?.id.sourceOffset ?? -1;
      expect(content.slice(offset).startsWith("create")).toBe(true);
    });

    test("does not glue a nested block comment onto statement 0", async () => {
      const content = `/* outer /* inner */ still header */
create schema app;`;
      const result = await parseSqlContent(content, "nested-block.sql");
      expect(result.statements).toHaveLength(1);
      const sql = result.statements[0]?.sql ?? "";
      expect(sql).not.toContain("outer");
      expect(sql).not.toContain("still header");
      expect(sql.toLowerCase().startsWith("create schema")).toBe(true);
    });

    test("keeps pg-topo annotation comments on the statement they precede", async () => {
      const content = `-- pg-topo:depends_on app.users
create view app.v as select 1;`;
      const result = await parseSqlContent(content, "annot-keep.sql");
      expect(result.statements).toHaveLength(1);
      const stmt = result.statements[0];
      expect(stmt?.sql).toContain("-- pg-topo:depends_on app.users");
      expect(stmt?.annotations.dependsOn).toEqual([
        { kind: "table", schema: "app", name: "users" },
      ]);
      const offset = stmt?.id.sourceOffset ?? -1;
      expect(content.slice(offset).startsWith("create")).toBe(true);
    });

    test("keeps pg-topo annotations but drops a following non-annotation note", async () => {
      const content = `-- pg-topo:phase routines
-- this view is for reporting
create view app.v as select 1;`;
      const result = await parseSqlContent(content, "annot-then-note.sql");
      const stmt = result.statements[0];
      expect(stmt?.sql).toContain("-- pg-topo:phase routines");
      expect(stmt?.sql).not.toContain("this view is for reporting");
      expect(stmt?.annotations.phase).toBe("routines");
      const offset = stmt?.id.sourceOffset ?? -1;
      expect(content.slice(offset).startsWith("create")).toBe(true);
    });

    test("keeps pg-topo annotations but drops a following block comment", async () => {
      const content = `-- pg-topo:depends_on app.users
/* reporting view */
create view app.v as select 1;`;
      const result = await parseSqlContent(content, "annot-then-block.sql");
      const stmt = result.statements[0];
      expect(stmt?.sql).toContain("-- pg-topo:depends_on app.users");
      expect(stmt?.sql).not.toContain("reporting view");
      expect(stmt?.annotations.dependsOn).toEqual([
        { kind: "table", schema: "app", name: "users" },
      ]);
    });

    test("strips a file-header comment but keeps the following pg-topo annotation", async () => {
      const content = `-- write header
-- pg-topo:phase routines
create view app.v as select 1;`;
      const result = await parseSqlContent(content, "header-annot.sql");
      const stmt = result.statements[0];
      expect(stmt?.sql.toLowerCase().startsWith("-- write")).toBe(false);
      expect(stmt?.sql).toContain("-- pg-topo:phase routines");
      expect(stmt?.annotations.phase).toBe("routines");
    });

    test("does not attach a mid-file comment to the previous statement", async () => {
      const content = `create table public.t(id int);
-- mid-file note
create view public.v as select id from public.t;`;
      const result = await parseSqlContent(content, "mid.sql");
      expect(result.statements).toHaveLength(2);
      expect(result.statements[0]?.sql).not.toContain("mid-file");
      expect(result.statements[1]?.sql).not.toContain("mid-file");
      expect(
        result.statements[1]?.sql.toLowerCase().startsWith("create view"),
      ).toBe(true);
      const offset = result.statements[1]?.id.sourceOffset ?? -1;
      expect(content.slice(offset).startsWith("create view")).toBe(true);
    });
  });

  // libpg_query omits stmt_len for a final statement with no terminating
  // semicolon, so the byte-slice path must extend to the end of the content
  // instead of falling back to the deparser (which is invalid for
  // COMMENT ON TRIGGER/POLICY/RULE and would drop the statement).
  describe("final statement without a terminating semicolon", () => {
    test("recovers an unterminated COMMENT ON TRIGGER verbatim", async () => {
      const content = "COMMENT ON TRIGGER tr ON public.t IS 'x'";
      const result = await parseSqlContent(content, "unterminated.sql");
      expect(result.diagnostics).toHaveLength(0);
      expect(result.statements).toHaveLength(1);
      expect(result.statements[0]?.sql).toBe(`${content};`);
    });

    test("recovers an unterminated non-ASCII COMMENT ON TRIGGER verbatim", async () => {
      const content = "COMMENT ON TRIGGER tr ON public.t IS '→→→'";
      const result = await parseSqlContent(content, "unterminated.sql");
      expect(result.diagnostics).toHaveLength(0);
      expect(result.statements).toHaveLength(1);
      expect(result.statements[0]?.sql).toBe(`${content};`);
    });

    test("recovers an unterminated final statement after earlier statements", async () => {
      const first = "comment on table public.t is '→→→';";
      const second = "COMMENT ON POLICY p ON public.t IS 'x'";
      const result = await parseSqlContent(
        `${first}\n${second}`,
        "unterminated.sql",
      );
      expect(result.diagnostics).toHaveLength(0);
      expect(result.statements).toHaveLength(2);
      expect(result.statements[0]?.sql).toBe(first);
      expect(result.statements[1]?.sql).toBe(`${second};`);
    });
  });
});
