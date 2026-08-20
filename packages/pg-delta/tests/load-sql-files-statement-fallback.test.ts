/**
 * Per-statement shadow-load fallback: when a whole file cannot commit, keep
 * the prefix that Postgres already accepted and retry only the rest.
 */
import { describe, expect, test } from "bun:test";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";
import { createTestDb } from "./containers.ts";

const OLD_SERIAL_SPLIT = [
  { name: "app/schema.sql", sql: `CREATE SCHEMA app;` },
  {
    name: "app/sequences/pages_id_seq.sql",
    sql: `
      CREATE SEQUENCE app.pages_id_seq AS bigint;
      ALTER SEQUENCE app.pages_id_seq OWNED BY app.pages.id;
    `,
  },
  {
    name: "app/tables/pages.sql",
    sql: `
      CREATE TABLE app.pages (
        id bigint NOT NULL DEFAULT nextval('app.pages_id_seq'::regclass),
        PRIMARY KEY (id)
      );
    `,
  },
];

describe("loadSqlFiles — statementFallback", () => {
  test("old serial split (CREATE+OWNED BY vs nextval) loads; splitFiles names the sequence file", async () => {
    const shadow = await createTestDb("sf_serial");
    try {
      const result = await loadSqlFiles(OLD_SERIAL_SPLIT, shadow.pool);
      expect(
        result.factBase.has({ kind: "table", schema: "app", name: "pages" }),
      ).toBe(true);
      expect(
        result.factBase.has({
          kind: "sequence",
          schema: "app",
          name: "pages_id_seq",
        }),
      ).toBe(true);
      expect(result.splitFiles).toEqual(["app/sequences/pages_id_seq.sql"]);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("table-before-sequence names still converge (prefix progress with same pending count)", async () => {
    const shadow = await createTestDb("sf_serial_rev");
    try {
      const result = await loadSqlFiles(
        [
          {
            name: "00_table.sql",
            sql: `
              CREATE SCHEMA app;
              CREATE TABLE app.pages (
                id bigint NOT NULL DEFAULT nextval('app.pages_id_seq'::regclass),
                PRIMARY KEY (id)
              );
            `,
          },
          {
            name: "01_seq.sql",
            sql: `
              CREATE SEQUENCE app.pages_id_seq AS bigint;
              ALTER SEQUENCE app.pages_id_seq OWNED BY app.pages.id;
            `,
          },
        ],
        shadow.pool,
      );
      expect(
        result.factBase.has({ kind: "table", schema: "app", name: "pages" }),
      ).toBe(true);
      expect(result.splitFiles).toEqual(["00_table.sql", "01_seq.sql"]);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("opt-out restores the old-split deadlock", async () => {
    const shadow = await createTestDb("sf_serial_off");
    try {
      let error: unknown;
      try {
        await loadSqlFiles(OLD_SERIAL_SPLIT, shadow.pool, {
          statementFallback: false,
        });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(
        (error as ShadowLoadError).details.some(
          (d) => d.code === "stuck_statement",
        ),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("mixed publications.sql keeps applied ADD TABLE; missing ADD retries", async () => {
    const shadow = await createTestDb("sf_pub");
    try {
      let error: unknown;
      try {
        await loadSqlFiles(
          [
            {
              name: "public/tables/t1.sql",
              sql: `CREATE TABLE public.t1 (id integer PRIMARY KEY);`,
            },
            {
              name: "_cluster/publications.sql",
              sql: `
                CREATE PUBLICATION p;
                ALTER PUBLICATION p ADD TABLE public.t1;
                ALTER PUBLICATION p ADD TABLE public.missing;
              `,
            },
          ],
          shadow.pool,
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(
        (error as ShadowLoadError).details.some(
          (d) => d.code === "stuck_statement",
        ),
      ).toBe(true);
      const { rows } = await shadow.pool.query<{ n: number }>(`
        SELECT count(*)::int AS n
        FROM pg_publication_rel pr
        JOIN pg_publication p ON p.oid = pr.prpubid
        JOIN pg_class c ON c.oid = pr.prrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE p.pubname = 'p' AND n.nspname = 'public' AND c.relname = 't1'
      `);
      expect(rows[0]!.n).toBe(1);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("default on: CREATE TABLE a + VIEW va FROM b leaves a and retries only va", async () => {
    const shadow = await createTestDb("sf_view");
    try {
      const result = await loadSqlFiles(
        [
          {
            name: "1_a.sql",
            sql: `CREATE TABLE public.a (id integer PRIMARY KEY);
                  CREATE VIEW public.va AS SELECT id FROM public.b;`,
          },
          {
            name: "2_b.sql",
            sql: `CREATE TABLE public.b (id integer PRIMARY KEY);`,
          },
        ],
        shadow.pool,
      );
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "a" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "view", schema: "public", name: "va" }),
      ).toBe(true);
      expect(result.splitFiles).toEqual(["1_a.sql"]);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("trailing -- comments cannot swallow the statement separator", async () => {
    const shadow = await createTestDb("sf_comment");
    try {
      const result = await loadSqlFiles(
        [
          {
            name: "1_a.sql",
            sql: `
              CREATE TABLE public.a (id integer PRIMARY KEY)
              -- keep a
              ;
              CREATE VIEW public.va AS SELECT id FROM public.b
              -- needs b
              ;
              CREATE VIEW public.vb AS SELECT id FROM public.a;
            `,
          },
          {
            name: "2_b.sql",
            sql: `CREATE TABLE public.b (id integer PRIMARY KEY);`,
          },
        ],
        shadow.pool,
      );
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "a" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "view", schema: "public", name: "va" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "view", schema: "public", name: "vb" }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("session-setting files stay file-atomic so SET LOCAL still scopes later DDL", async () => {
    const shadow = await createTestDb("sf_setlocal");
    try {
      const result = await loadSqlFiles(
        [
          {
            name: "1_a.sql",
            sql: `
              CREATE SCHEMA app;
              SET LOCAL search_path TO app;
              CREATE TABLE t (id integer PRIMARY KEY);
              CREATE VIEW va AS SELECT id FROM public.b;
            `,
          },
          {
            name: "2_b.sql",
            sql: `CREATE TABLE public.b (id integer PRIMARY KEY);`,
          },
        ],
        shadow.pool,
      );
      expect(
        result.factBase.has({ kind: "table", schema: "app", name: "t" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "t" }),
      ).toBe(false);
      expect(result.splitFiles).toEqual([]);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("splitFiles is empty when fallback is off or every file commits atomically", async () => {
    const shadowA = await createTestDb("sf_empty_off");
    const shadowB = await createTestDb("sf_empty_ok");
    try {
      const off = await loadSqlFiles(
        [
          {
            name: "1_a.sql",
            sql: `CREATE TABLE public.a (id integer PRIMARY KEY);
                  CREATE VIEW public.va AS SELECT id FROM public.b;`,
          },
          {
            name: "2_b.sql",
            sql: `CREATE TABLE public.b (id integer PRIMARY KEY);`,
          },
        ],
        shadowA.pool,
        { statementFallback: false },
      );
      expect(off.splitFiles).toEqual([]);

      const ok = await loadSqlFiles(
        [
          { name: "schema.sql", sql: `CREATE SCHEMA app;` },
          { name: "table.sql", sql: `CREATE TABLE app.t (id integer);` },
        ],
        shadowB.pool,
      );
      expect(ok.splitFiles).toEqual([]);
    } finally {
      await Promise.all([shadowA.drop(), shadowB.drop()]);
    }
  }, 60_000);
});
