/**
 * Slice 2 — the statement-reordering assist restores "author files in any
 * internal order, it still loads".
 *
 * The parser-free shadow loader runs whole files as one transaction, so it
 * cannot reorder statements WITHIN a file: a `CREATE VIEW` authored before its
 * `CREATE TABLE` in the same file never converges (file granularity). Feeding
 * the same files through `orderForShadow` first splits them into one-statement
 * units and topologically pre-sorts them, so the loader becomes
 * statement-granular and converges. `--no-reorder` (raw files) reproduces the
 * stuck case.
 *
 * Docker required (real shadow database via testcontainers).
 */
import { describe, expect, test } from "bun:test";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";
import {
  analyzeForShadow,
  orderForShadow,
} from "../src/frontends/sql-order.ts";
import {
  appendShadowCycleHint,
  rewriteReorderedShadowError,
} from "../src/cli/reorder-display.ts";
import { createTestDb } from "./containers.ts";

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("statement-reordering assist (orderForShadow → loadSqlFiles)", () => {
  test("intra-file VIEW-before-TABLE converges with reorder", async () => {
    const files = [
      {
        name: "schema.sql",
        sql:
          "CREATE VIEW public.v AS SELECT id FROM public.t;\n" +
          "CREATE TABLE public.t (id integer PRIMARY KEY);",
      },
    ];

    const shadow = await createTestDb("shadow");
    try {
      const ordered = await orderForShadow(files);
      const result = await loadSqlFiles(ordered, shadow.pool);
      expect(
        result.factBase.has({ kind: "view", schema: "public", name: "v" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "t" }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("intra-file VIEW-before-TABLE is STUCK without reorder (--no-reorder)", async () => {
    const files = [
      {
        name: "schema.sql",
        sql:
          "CREATE VIEW public.v AS SELECT id FROM public.t;\n" +
          "CREATE TABLE public.t (id integer PRIMARY KEY);",
      },
    ];

    const shadow = await createTestDb("shadow");
    try {
      const error = await captureError(loadSqlFiles(files, shadow.pool));
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect((error as ShadowLoadError).message).toMatch(
        /stuck|did not converge/i,
      );
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("intra-file mutual FK (split via ALTER) in wrong order converges with reorder", async () => {
    // a realistic mutual relationship split into a separate ALTER (the supported
    // shape), authored in dependency-reverse order inside ONE file. File
    // granularity cannot reorder it → stuck; reorder splits + sorts → converges.
    const files = [
      {
        name: "schema.sql",
        sql:
          "ALTER TABLE public.a ADD CONSTRAINT a_b_fk FOREIGN KEY (b_id) REFERENCES public.b(id);\n" +
          "CREATE TABLE public.b (id integer PRIMARY KEY, a_id integer REFERENCES public.a(id));\n" +
          "CREATE TABLE public.a (id integer PRIMARY KEY, b_id integer);",
      },
    ];

    const reordered = await createTestDb("shadow");
    try {
      const ordered = await orderForShadow(files);
      const result = await loadSqlFiles(ordered, reordered.pool);
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "a" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "b" }),
      ).toBe(true);
    } finally {
      await reordered.drop();
    }

    const raw = await createTestDb("shadow");
    try {
      const error = await captureError(loadSqlFiles(files, raw.pool));
      expect(error).toBeInstanceOf(ShadowLoadError);
    } finally {
      await raw.drop();
    }
  }, 90_000);

  test("a genuinely unresolved reference surfaces real file:line:col after rewrite", async () => {
    const content =
      "CREATE TABLE public.t (id integer PRIMARY KEY);\n" +
      "CREATE VIEW public.v AS SELECT * FROM public.missing;";
    const files = [{ name: "schema.sql", sql: content }];

    const shadow = await createTestDb("shadow");
    try {
      const ordered = await orderForShadow(files);
      const error = (await captureError(
        loadSqlFiles(ordered, shadow.pool),
      )) as ShadowLoadError;
      expect(error).toBeInstanceOf(ShadowLoadError);

      const originalSqlByName = new Map(files.map((f) => [f.name, f.sql]));
      const rewritten = rewriteReorderedShadowError(
        error,
        ordered,
        originalSqlByName,
      );

      const detailText = rewritten.details.map((d) => d.message).join("\n");
      // the offending CREATE VIEW is on line 2 of schema.sql
      expect(detailText).toContain("schema.sql:2:1");
      // synthetic ordinal names must not leak
      expect(detailText).not.toMatch(/\d+__schema\.sql/);
      // Postgres' own text is preserved
      expect(detailText.toLowerCase()).toContain("missing");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("an unbreakable inline mutual FK stays stuck and gains a labeled cycle hint (D6)", async () => {
    // both FKs are inline, so neither table can be created first — a genuine
    // shadow-load cycle that round-retry cannot resolve. The assist statically
    // detects it; the CLI attaches the members as an advisory hint on top of the
    // (authoritative) Postgres stuck error.
    const content =
      "CREATE TABLE public.a (id integer PRIMARY KEY, b_id integer REFERENCES public.b(id));\n" +
      "CREATE TABLE public.b (id integer PRIMARY KEY, a_id integer REFERENCES public.a(id));";
    const files = [{ name: "schema.sql", sql: content }];

    const shadow = await createTestDb("shadow");
    try {
      const { files: ordered, cycles } = await analyzeForShadow(files);
      expect(cycles.length).toBeGreaterThan(0);

      const error = (await captureError(
        loadSqlFiles(ordered, shadow.pool),
      )) as ShadowLoadError;
      expect(error).toBeInstanceOf(ShadowLoadError);

      const originalSqlByName = new Map(files.map((f) => [f.name, f.sql]));
      const enriched = appendShadowCycleHint(
        rewriteReorderedShadowError(error, ordered, originalSqlByName),
        cycles,
        originalSqlByName,
      );

      // the authoritative PG-driven stuck text remains…
      expect(enriched.message.toLowerCase()).toMatch(/stuck|did not converge/);
      // …with a clearly-labeled, advisory cycle hint rendered as the chain of
      // real source locations of the two mutually-referencing statements
      expect(enriched.message.toLowerCase()).toContain("suspected");
      expect(enriched.message).toContain("→");
      expect(enriched.message).toContain("schema.sql:1:1");
      expect(enriched.message).toContain("schema.sql:2:1");
      // pg-topo identifies the cycle by the two FK constraints (a and b)
      expect(enriched.message).toContain("public:a");
      expect(enriched.message).toContain("public:b");
      expect(
        enriched.details.some((d) => d.code === "suspected_shadow_load_cycle"),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);
});
