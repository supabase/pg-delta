/**
 * SERIAL / explicit OWNED BY must export CREATE SEQUENCE (+ grants) in
 * sequences/ and ALTER SEQUENCE … OWNED BY in the owning table file, so the
 * file-atomic loader can apply the sequence file before the table file.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { sharedCluster } from "./containers.ts";

describe("export: serial OWNED BY files with the table", () => {
  test("bigserial puts OWNED BY in the table file; load is file-atomic", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("ser_src");
    const shadow = await cluster.createDb("ser_shadow");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.pages (
          id bigserial PRIMARY KEY,
          path text NOT NULL
        );
        GRANT USAGE ON SEQUENCE app.pages_id_seq TO PUBLIC;
      `);
      const fb = (await extract(source.pool)).factBase;
      const files = exportSqlFiles(fb).filter(
        (f) => !f.name.startsWith("_cluster/roles"),
      );
      const seq = files.find((f) => f.name.includes("/sequences/"));
      const table = files.find((f) => f.name === "app/tables/pages.sql");
      expect(seq).toBeDefined();
      expect(table).toBeDefined();
      expect(seq!.sql).toMatch(/CREATE SEQUENCE/i);
      expect(seq!.sql).not.toMatch(/OWNED BY/i);
      expect(seq!.sql).toMatch(/GRANT USAGE/i);
      expect(seq!.sql).not.toMatch(/OWNER TO/i);
      expect(table!.sql).toMatch(/CREATE TABLE/i);
      expect(table!.sql).toMatch(/OWNED BY/i);
      expect(table!.sql).not.toMatch(/GRANT USAGE ON SEQUENCE/i);

      const loaded = await loadSqlFiles(files, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([source.drop(), shadow.drop()]);
    }
  }, 120_000);

  test("non-default owner: sequence OWNER TO files with the table after table OWNER TO", async () => {
    const cluster = await sharedCluster();
    const role = `ser_own_${crypto.randomUUID().slice(0, 8)}`;
    const source = await cluster.createDb("ser_own_src");
    const shadow = await cluster.createDb("ser_own_shadow");
    try {
      await source.pool.query(`CREATE ROLE "${role}" NOLOGIN`);
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.pages (
          id bigserial PRIMARY KEY,
          path text NOT NULL
        );
        ALTER TABLE app.pages OWNER TO "${role}";
      `);
      const fb = (await extract(source.pool)).factBase;
      const files = exportSqlFiles(fb).filter(
        (f) => !f.name.startsWith("_cluster/roles"),
      );
      const seq = files.find((f) => f.name.includes("/sequences/"));
      const table = files.find((f) => f.name === "app/tables/pages.sql");
      expect(seq).toBeDefined();
      expect(table).toBeDefined();
      expect(seq!.sql).toMatch(/CREATE SEQUENCE/i);
      expect(seq!.sql).not.toMatch(/OWNED BY/i);
      expect(seq!.sql).not.toMatch(/OWNER TO/i);
      expect(table!.sql).toMatch(/OWNED BY/i);
      expect(table!.sql).toMatch(/ALTER TABLE[\s\S]*OWNER TO/i);
      expect(table!.sql).toMatch(/ALTER SEQUENCE[\s\S]*OWNER TO/i);
      const tableOwnerAt = table!.sql.search(/ALTER TABLE[\s\S]*OWNER TO/i);
      const seqOwnerAt = table!.sql.search(/ALTER SEQUENCE[\s\S]*OWNER TO/i);
      expect(tableOwnerAt).toBeGreaterThan(-1);
      expect(seqOwnerAt).toBeGreaterThan(tableOwnerAt);

      const loaded = await loadSqlFiles(files, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([source.drop(), shadow.drop()]);
      await cluster.adminPool.query(`DROP ROLE IF EXISTS "${role}"`);
    }
  }, 120_000);

  test("a well-ordered one-file serial pair still loads", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("ser_one");
    try {
      const loaded = await loadSqlFiles(
        [
          {
            name: "app.sql",
            sql: `
              CREATE SCHEMA app;
              CREATE SEQUENCE app.pages_id_seq AS bigint;
              CREATE TABLE app.pages (
                id bigint NOT NULL DEFAULT nextval('app.pages_id_seq'::regclass),
                PRIMARY KEY (id)
              );
              ALTER SEQUENCE app.pages_id_seq OWNED BY app.pages.id;
            `,
          },
        ],
        shadow.pool,
      );
      expect(
        loaded.factBase.has({
          kind: "table",
          schema: "app",
          name: "pages",
        }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);
});
