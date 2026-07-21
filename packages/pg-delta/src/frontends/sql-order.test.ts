/**
 * Unit tests for the statement-reordering assist (`orderForShadow`).
 *
 * The assist is advisory: it splits the user's SQL files into one-statement
 * units and topologically pre-sorts them so the parser-free shadow loader
 * ([`load-sql-files.ts`](./load-sql-files.ts)) converges in fewer rounds. It is
 * NEVER trusted for correctness — Postgres elaborates the shadow (principle P1)
 * — so the only hard guarantees it must keep are structural:
 *
 * - one statement per output `SqlFile`, fed straight into `loadSqlFiles`;
 * - a zero-padded ordinal name prefix so the loader's per-round lexicographic
 *   `name` sort reproduces topo order (D4 option `a`);
 * - every input statement preserved exactly once — including statements
 *   pg-topo cannot classify (`UNKNOWN`) and statements trapped in a cycle;
 * - statement text carried verbatim;
 * - deterministic output for the same input.
 *
 * No Docker required (pg-topo is a pure WASM parser; no shadow DB is loaded).
 */
import { describe, expect, test } from "bun:test";
import {
  __setPgTopoImporterForTests,
  analyzeForShadow,
  canReorder,
  orderForShadow,
  ReorderParseError,
  ReorderUnavailableError,
  type OrderedSqlFile,
} from "./sql-order.ts";
import type { SqlFile } from "./load-sql-files.ts";

const file = (name: string, sql: string): SqlFile => ({ name, sql });

const ORDINAL_PREFIX = /^\d+__/;

describe("orderForShadow — split + topological pre-sort", () => {
  test("reorders an intra-file VIEW-before-TABLE into TABLE-before-VIEW", async () => {
    // a single file authored in the wrong internal order
    const files = [
      file(
        "schema.sql",
        "create view public.v as select id from public.t;\n" +
          "create table public.t(id int primary key);",
      ),
    ];

    const ordered = await orderForShadow(files);

    // split into one statement per SqlFile
    expect(ordered).toHaveLength(2);
    for (const out of ordered) {
      expect(out.sql.match(/;/g) ?? []).toHaveLength(1);
    }

    // the TABLE now precedes the VIEW
    expect(ordered[0]?.sql.toLowerCase()).toContain("create table public.t");
    expect(ordered[1]?.sql.toLowerCase()).toContain("create view public.v");
  });

  test("ordinal name prefix makes lexicographic name sort equal topo order", async () => {
    const files = [
      file(
        "schema.sql",
        "create view public.v as select id from public.t;\n" +
          "create table public.t(id int primary key);",
      ),
    ];

    const ordered = await orderForShadow(files);

    // every name is ordinal-prefixed and references the original file
    for (const out of ordered) {
      expect(out.name).toMatch(ORDINAL_PREFIX);
      expect(out.name).toContain("schema.sql");
    }

    // re-sorting by name (what the loader does each round) preserves topo order
    const byName = [...ordered].sort((a, b) => (a.name < b.name ? -1 : 1));
    expect(byName.map((f) => f.sql)).toEqual(ordered.map((f) => f.sql));

    // ordinals are zero-padded to a consistent width so the sort is stable
    const prefixes = ordered.map((f) => f.name.match(/^(\d+)__/)?.[1] ?? "");
    const widths = new Set(prefixes.map((p) => p.length));
    expect(widths.size).toBe(1);
  });

  test("carries provenance back to the original file + statement index", async () => {
    const files = [
      file(
        "schema.sql",
        "create view public.v as select id from public.t;\n" +
          "create table public.t(id int primary key);",
      ),
    ];

    const ordered: OrderedSqlFile[] = await orderForShadow(files);

    for (const out of ordered) {
      expect(out.provenance.filePath).toBe("schema.sql");
      expect(typeof out.provenance.statementIndex).toBe("number");
    }
    // the TABLE was authored second in the file → statementIndex 1
    const table = ordered.find((f) => /create table/i.test(f.sql));
    expect(table?.provenance.statementIndex).toBe(1);
  });

  test("preserves every statement exactly once, including UNKNOWN classes", async () => {
    const files = [
      file("a.sql", "create table public.t(id int primary key);"),
      // pg-topo classifies VACUUM as UNKNOWN — it must still be carried through
      file("b.sql", "vacuum public.t;"),
    ];

    const ordered = await orderForShadow(files);

    expect(ordered).toHaveLength(2);
    const sqls = ordered.map((f) => f.sql.trim().toLowerCase()).sort();
    expect(sqls).toEqual([
      "create table public.t(id int primary key);",
      "vacuum public.t;",
    ]);
  });

  test("preserves cycle members instead of dropping them", async () => {
    // inline mutual FK across two files → a shadow-load cycle. The assist cannot
    // resolve it, but must still emit both statements so the loader can surface
    // its real Postgres error (and, later, the mutual-FK hint).
    const files = [
      file(
        "a.sql",
        "create table public.a(id int primary key, b_id int references public.b(id));",
      ),
      file(
        "b.sql",
        "create table public.b(id int primary key, a_id int references public.a(id));",
      ),
    ];

    const ordered = await orderForShadow(files);

    expect(ordered).toHaveLength(2);
    const names = ordered.map((f) => f.provenance.filePath).sort();
    expect(names).toEqual(["a.sql", "b.sql"]);
  });

  test("carries statement text verbatim", async () => {
    const sql = "create   table  public.t (  id   int  primary key );";
    const files = [file("a.sql", sql)];

    const ordered = await orderForShadow(files);

    expect(ordered).toHaveLength(1);
    // whitespace/formatting is preserved exactly (modulo the trailing splitter)
    expect(ordered[0]?.sql).toContain("create   table  public.t");
  });

  test("is deterministic for the same input", async () => {
    const files = [
      file("schema.sql", "create schema app;"),
      file("view.sql", "create view app.v as select id from app.t;"),
      file("table.sql", "create table app.t(id int primary key);"),
    ];

    const first = await orderForShadow(files);
    const second = await orderForShadow(files);

    expect(second.map((f) => f.name)).toEqual(first.map((f) => f.name));
    expect(second.map((f) => f.sql)).toEqual(first.map((f) => f.sql));
  });

  test("returns an empty list for empty input", async () => {
    expect(await orderForShadow([])).toEqual([]);
  });
});

describe("orderForShadow — must not silently drop unparseable statements", () => {
  test("throws ReorderParseError when pg-topo cannot parse an input (would shrink the file set)", async () => {
    // pg-topo returns an empty statement list for a whole-content PARSE_ERROR,
    // so the offending file vanishes from the ordered output. The convenience
    // API discards diagnostics, so a raw `orderForShadow` caller would silently
    // build an INCOMPLETE desired state — the invariant: no caller may receive a
    // silently-shrunk file set.
    const files = [
      file("good.sql", "create table public.t(id int primary key);"),
      file("bad.sql", "this is definitely not valid sql !!!;"),
    ];

    let thrown: unknown;
    try {
      await orderForShadow(files);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ReorderParseError);
    expect((thrown as Error).message).toContain("bad.sql");
    // points the caller at the graceful-degradation escape hatch
    expect((thrown as Error).message).toMatch(/analyzeForShadow|raw/i);
    expect((thrown as ReorderParseError).diagnostics.length).toBeGreaterThan(0);
  });

  test("does not throw when every statement parses", async () => {
    const ordered = await orderForShadow([
      file("t.sql", "create table public.t(id int primary key);"),
      file("v.sql", "create view public.v as select id from public.t;"),
    ]);
    expect(ordered).toHaveLength(2);
  });
});

describe("orderForShadow — degradation when pg-topo is absent", () => {
  test("throws a typed ReorderUnavailableError with an install hint", async () => {
    __setPgTopoImporterForTests(() => {
      throw new Error("Cannot find module '@supabase/pg-topo'");
    });
    try {
      let thrown: unknown;
      try {
        await orderForShadow([file("a.sql", "create table public.t(id int);")]);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ReorderUnavailableError);
      expect((thrown as Error).message).toContain("@supabase/pg-topo");
      expect((thrown as Error).message).toMatch(/install|add/i);
    } finally {
      __setPgTopoImporterForTests(null);
    }
  });

  test("canReorder() reports false when absent, true when present", async () => {
    __setPgTopoImporterForTests(() => {
      throw new Error("Cannot find module '@supabase/pg-topo'");
    });
    expect(await canReorder()).toBe(false);

    __setPgTopoImporterForTests(null);
    expect(await canReorder()).toBe(true);
  });
});

describe("analyzeForShadow — cycle surfacing (D6)", () => {
  test("reports cycle members mapped back to real provenance", async () => {
    // inline mutual FK across two files → a shadow-load cycle pg-topo detects
    const files = [
      file(
        "a.sql",
        "create table public.a(id int primary key, b_id int references public.b(id));",
      ),
      file(
        "b.sql",
        "create table public.b(id int primary key, a_id int references public.a(id));",
      ),
    ];

    const { files: ordered, cycles } = await analyzeForShadow(files);

    // files are still the full single-statement set (Slice 1 contract intact)
    expect(ordered).toHaveLength(2);

    // a cycle is surfaced, with members mapped to the ORIGINAL file names
    expect(cycles.length).toBeGreaterThan(0);
    const memberFiles = cycles
      .flatMap((c) => c.members.map((m) => m.filePath))
      .sort();
    expect(memberFiles).toEqual(["a.sql", "b.sql"]);
    // members carry their statement index; none reference the synthetic <input:i>
    for (const cycle of cycles) {
      for (const member of cycle.members) {
        expect(member.filePath).not.toMatch(/^<input:\d+>$/);
        expect(typeof member.statementIndex).toBe("number");
      }
    }
  });

  test("reports no cycles for an acyclic schema", async () => {
    const { cycles } = await analyzeForShadow([
      file("t.sql", "create table public.t(id int primary key);"),
      file("v.sql", "create view public.v as select id from public.t;"),
    ]);
    expect(cycles).toEqual([]);
  });
});

describe("analyzeForShadow — pg-topo diagnostics (lint)", () => {
  test("surfaces an UNKNOWN_STATEMENT_CLASS diagnostic mapped to its file", async () => {
    const { diagnostics } = await analyzeForShadow([
      file("t.sql", "create table public.t(id int primary key);"),
      file("vacuum.sql", "vacuum public.t;"),
    ]);
    const unknown = diagnostics.find(
      (d) => d.code === "UNKNOWN_STATEMENT_CLASS",
    );
    expect(unknown).toBeDefined();
    expect(unknown?.location?.filePath).toBe("vacuum.sql");
  });

  test("has no error-class diagnostics for a clean acyclic schema", async () => {
    const { diagnostics } = await analyzeForShadow([
      file("t.sql", "create table public.t(id int primary key);"),
      file("v.sql", "create view public.v as select id from public.t;"),
    ]);
    expect(
      diagnostics.some(
        (d) => d.code === "CYCLE_DETECTED" || d.code === "PARSE_ERROR",
      ),
    ).toBe(false);
  });
});
