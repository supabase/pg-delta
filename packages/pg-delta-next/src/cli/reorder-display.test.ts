/**
 * Unit tests for the reorder display helpers.
 *
 * When the statement-reordering assist is on, the shadow loader sees synthetic
 * one-statement file names (`0007__schema/users.sql`) and bakes them into its
 * error strings. The CLI must present those back to the author as the real
 * source location (`schema/users.sql:line:col`) — stripping the ordinal prefix
 * and resolving the statement's offset against the original file content. The
 * Postgres error text itself is preserved verbatim (D6: PG errors stay
 * authoritative).
 *
 * No Docker required (pure string/offset functions).
 */
import { describe, expect, test } from "bun:test";
import {
  appendShadowCycleHint,
  formatStatementLocation,
  positionToLineColumn,
  rewriteReorderedShadowError,
  stripOrdinalPrefix,
} from "./reorder-display.ts";
import { ShadowLoadError } from "../frontends/load-sql-files.ts";
import type {
  OrderedSqlFile,
  ShadowLoadCycle,
} from "../frontends/sql-order.ts";

describe("stripOrdinalPrefix", () => {
  test("removes a zero-padded ordinal prefix", () => {
    expect(stripOrdinalPrefix("0007__schema/users.sql")).toBe(
      "schema/users.sql",
    );
    expect(stripOrdinalPrefix("00__a.sql")).toBe("a.sql");
  });

  test("leaves a name without an ordinal prefix unchanged", () => {
    expect(stripOrdinalPrefix("schema/users.sql")).toBe("schema/users.sql");
    // a double underscore that is not an ordinal prefix is preserved
    expect(stripOrdinalPrefix("my__file.sql")).toBe("my__file.sql");
  });
});

describe("positionToLineColumn", () => {
  test("1-based line/column for a single line", () => {
    expect(positionToLineColumn("hello", 1)).toEqual({ line: 1, column: 1 });
    expect(positionToLineColumn("hello", 5)).toEqual({ line: 1, column: 5 });
  });

  test("counts newlines", () => {
    expect(positionToLineColumn("ab\ncd\nef", 5)).toEqual({
      line: 2,
      column: 2,
    });
  });
});

describe("formatStatementLocation", () => {
  test("renders file:line:col when sourceOffset + content are available", () => {
    const content = "create table t(id int);\ncreate view v as select 1;";
    // the second statement starts at offset 24 (the char after the first ';\n')
    const offset = content.indexOf("create view");
    expect(
      formatStatementLocation(
        { filePath: "schema.sql", statementIndex: 1, sourceOffset: offset },
        content,
      ),
    ).toBe("schema.sql:2:1");
  });

  test("falls back to the bare file path when offset/content are missing", () => {
    expect(
      formatStatementLocation({ filePath: "schema.sql", statementIndex: 0 }),
    ).toBe("schema.sql");
  });
});

describe("rewriteReorderedShadowError", () => {
  const orderedFile = (
    name: string,
    filePath: string,
    statementIndex: number,
    sourceOffset: number,
  ): OrderedSqlFile => ({
    name,
    sql: "",
    provenance: { filePath, statementIndex, sourceOffset },
  });

  test("replaces synthetic ordinal names with file:line:col in message + details, preserving PG text", () => {
    const content =
      "create view public.v as select id from public.t;\n" +
      "create table public.t(id int primary key);";
    const ordered = [
      orderedFile(
        "0__schema.sql",
        "schema.sql",
        1,
        content.indexOf("create table"),
      ),
      orderedFile("1__schema.sql", "schema.sql", 0, 0),
    ];
    const originalSqlByName = new Map([["schema.sql", content]]);

    const error = new ShadowLoadError(
      "shadow load stuck after 1 round(s): 1 file(s) cannot apply",
      [
        {
          code: "stuck_statement",
          severity: "error",
          message: '1__schema.sql: relation "public.t" does not exist',
        },
      ],
    );

    const rewritten = rewriteReorderedShadowError(
      error,
      ordered,
      originalSqlByName,
    );

    // the synthetic name is gone, replaced by the real source location…
    expect(rewritten.details[0]?.message).toContain("schema.sql:1:1:");
    expect(rewritten.details[0]?.message).not.toMatch(/\d+__schema\.sql/);
    // …and the Postgres text is preserved verbatim
    expect(rewritten.details[0]?.message).toContain(
      'relation "public.t" does not exist',
    );
    // it is still a ShadowLoadError
    expect(rewritten).toBeInstanceOf(ShadowLoadError);
  });

  test("is a no-op for names that carry no ordinal/provenance", () => {
    const error = new ShadowLoadError("shadow database is not empty", []);
    const rewritten = rewriteReorderedShadowError(error, [], new Map());
    expect(rewritten.message).toBe("shadow database is not empty");
  });
});

describe("appendShadowCycleHint (D6)", () => {
  const content =
    "create table public.a(id int primary key, b_id int references public.b(id));\n" +
    "create table public.b(id int primary key, a_id int references public.a(id));";
  const originalSqlByName = new Map([["schema.sql", content]]);
  const cycle: ShadowLoadCycle = {
    members: [
      { filePath: "schema.sql", statementIndex: 0, sourceOffset: 0 },
      {
        filePath: "schema.sql",
        statementIndex: 1,
        sourceOffset: content.indexOf("create table public.b"),
      },
    ],
    objectKeys: ["table:public.a", "table:public.b"],
  };

  const stuckError = (): ShadowLoadError =>
    new ShadowLoadError(
      "shadow load stuck after 1 round(s): 2 file(s) cannot apply",
      [
        {
          code: "stuck_statement",
          severity: "error",
          message: 'schema.sql:1:1: relation "public.b" does not exist',
        },
      ],
    );

  test("appends a clearly-labeled, advisory static-analysis hint", () => {
    const enriched = appendShadowCycleHint(
      stuckError(),
      [cycle],
      originalSqlByName,
    );

    // the message keeps the authoritative PG-driven stuck text…
    expect(enriched.message).toContain("shadow load stuck");
    // …and gains a labeled, advisory cycle hint
    expect(enriched.message.toLowerCase()).toContain("suspected");
    expect(enriched.message.toLowerCase()).toMatch(
      /advisory|static analysis|authoritative/,
    );
    // rendered as the cycle chain with real file:line:col + a back-edge
    expect(enriched.message).toContain("schema.sql:1:1");
    expect(enriched.message).toContain("schema.sql:2:1");
    expect(enriched.message).toContain("→");
    // object keys surfaced
    expect(enriched.message).toContain("table:public.a");

    // a structured hint diagnostic is added without disturbing the PG one
    const codes = enriched.details.map((d) => d.code);
    expect(codes).toContain("stuck_statement");
    expect(codes).toContain("suspected_shadow_load_cycle");
    const hint = enriched.details.find(
      (d) => d.code === "suspected_shadow_load_cycle",
    );
    expect(hint?.severity).toBe("warning");
  });

  test("is a no-op when there are no cycles", () => {
    const error = stuckError();
    const same = appendShadowCycleHint(error, [], originalSqlByName);
    expect(same.message).toBe(error.message);
    expect(same.details).toHaveLength(error.details.length);
  });
});
