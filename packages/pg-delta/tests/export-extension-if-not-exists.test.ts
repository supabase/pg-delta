/**
 * Live bootstrap for `--create-extension-if-not-exists`: export an installed
 * extension and replay the tree onto a database that already has it. Public
 * install only — a managed CREATE SCHEMA stays plain CREATE (PR #444 triage).
 *
 * Docker required.
 */
import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import type { FactBase } from "../src/core/fact.ts";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import type { SqlFile } from "../src/frontends/load-sql-files.ts";
import { sharedCluster } from "./containers.ts";

function schemaFiles(
  fb: FactBase,
  createExtensionIfNotExists?: boolean,
): SqlFile[] {
  const options =
    createExtensionIfNotExists === true
      ? { createExtensionIfNotExists: true }
      : {};
  return exportSqlFiles(fb, options).filter(
    (f) => !f.name.startsWith("_cluster/roles"),
  );
}

async function applyFiles(pool: Pool, files: SqlFile[]): Promise<void> {
  for (const file of files) {
    if (file.sql.trim() === "") continue;
    await pool.query(file.sql);
  }
}

describe("export CREATE EXTENSION IF NOT EXISTS (live replay)", () => {
  test("replays onto a database that already has the extension", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("ext_ine_src");
    const targetOk = await cluster.createDb("ext_ine_ok");
    const targetFail = await cluster.createDb("ext_ine_fail");
    try {
      await source.pool.query(`CREATE EXTENSION pgcrypto`);
      const fb = (await extract(source.pool)).factBase;

      const plain = schemaFiles(fb);
      const guarded = schemaFiles(fb, true);
      expect(guarded.map((f) => f.sql).join("\n")).toContain(
        `CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA "public"`,
      );

      await targetOk.pool.query(`CREATE EXTENSION pgcrypto`);
      await applyFiles(targetOk.pool, guarded);

      await targetFail.pool.query(`CREATE EXTENSION pgcrypto`);
      // No `await`: bun's typings declare `.rejects.toThrow()` as void
      // (oxlint await-thenable rejects it) and the runner tracks the
      // pending assertion itself, failing this test if it resolves.
      expect(applyFiles(targetFail.pool, plain)).rejects.toThrow(
        /already exists/i,
      );
    } finally {
      await Promise.all([source.drop(), targetOk.drop(), targetFail.drop()]);
    }
  }, 120_000);
});
