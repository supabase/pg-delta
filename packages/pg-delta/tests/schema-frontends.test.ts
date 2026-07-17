/**
 * Public schema frontend API: buildSchemaExport / planSchemaFiles /
 * provisionCoLocatedShadow. Integration (Postgres via testcontainers).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import {
  buildSchemaExport,
  planSchemaFiles,
  provisionCoLocatedShadow,
  readExportManifest,
  renderPlanFiles,
  ShadowProvisionError,
  writeExportManifest,
  type ManagementScope,
  type SqlFile,
} from "../src/frontends/index.ts";
import { rawProfile } from "../src/integrations/index.ts";
import { sharedCluster } from "./containers.ts";

const SCHEMA_SQL = `
  CREATE SCHEMA app;
  CREATE TABLE app.items (id integer PRIMARY KEY, name text NOT NULL);
`;

describe("public schema frontends", () => {
  test("buildSchemaExport reproduces CLI export files + manifest (raw, database scope)", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("frontend_export_src");
    try {
      await source.pool.query(SCHEMA_SQL);
      const result = await buildSchemaExport(source.pool, {
        profile: rawProfile,
        scope: "database",
        layout: "by-object",
        format: { keywordCase: "lower", maxWidth: 180 },
      });

      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files.some((f) => f.name.includes("items"))).toBe(true);
      expect(result.files.some((f) => f.name.includes("cluster/roles"))).toBe(
        false,
      );
      expect(result.manifest).toMatchObject({
        redactSecrets: true,
        scope: "database" satisfies ManagementScope,
        profile: "raw",
      });
      expect("defaultOwner" in result.manifest).toBe(true);
    } finally {
      await source.drop();
    }
  }, 90_000);

  test("buildSchemaExport cluster scope retains roles/memberships", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("frontend_export_cl");
    try {
      await source.pool.query(SCHEMA_SQL);
      const result = await buildSchemaExport(source.pool, {
        profile: rawProfile,
        scope: "cluster",
        layout: "by-object",
        format: { keywordCase: "lower", maxWidth: 180 },
      });

      expect(result.files.some((f) => f.name.includes("cluster/roles"))).toBe(
        true,
      );
      expect(result.manifest.scope).toBe("cluster");
      expect("defaultOwner" in result.manifest).toBe(false);
    } finally {
      await source.drop();
    }
  }, 90_000);

  test("database-scope planSchemaFiles rejects cluster DDL before loading shadow", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_rej");
    try {
      const files: SqlFile[] = [
        { name: "roles.sql", sql: "CREATE ROLE frontend_probe nologin;\n" },
        { name: "t.sql", sql: "CREATE TABLE public.t (id int);\n" },
      ];
      expect(
        planSchemaFiles(target.pool, target.pool, files, {
          profile: rawProfile,
          scope: "database",
        }),
      ).rejects.toThrow(/cluster DDL/);
    } finally {
      await target.drop();
    }
  }, 90_000);

  test("planSchemaFiles + renderPlanFiles preserve preamble and apply converges", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("frontend_plan_src");
    const target = await cluster.createDb("frontend_plan_tgt");
    try {
      await source.pool.query(SCHEMA_SQL);
      const exported = await buildSchemaExport(source.pool, {
        profile: rawProfile,
        scope: "database",
        layout: "ordered",
        format: { keywordCase: "lower", maxWidth: 180 },
      });

      const shadow = await provisionCoLocatedShadow(target.uri, {
        uniqueSuffix: `ok_${Date.now().toString(36)}`,
      });
      const shadowPool = new pg.Pool({ connectionString: shadow.url, max: 5 });
      try {
        const planned = await planSchemaFiles(
          target.pool,
          shadowPool,
          exported.files,
          {
            profile: rawProfile,
            scope: "database",
            manifest: exported.manifest,
            seedAssumedSchemas: true,
          },
        );
        expect(planned.plan.actions.length).toBeGreaterThan(0);

        const rendered = renderPlanFiles(planned.plan, { allowDrops: true });
        expect(rendered.changes).toBe(true);
        expect(rendered.files.length).toBeGreaterThan(0);
        for (const file of rendered.files) {
          if (planned.plan.preamble.length > 0) {
            expect(file.contents).toContain("set ");
          }
        }

        const report = await apply(planned.plan, target.pool, {
          ...planned.applyOptions,
          reextract: (p) => planned.extract(p, { redactSecrets: true }),
          fingerprintGate: true,
        });
        expect(report.status).toBe("applied");
      } finally {
        await shadowPool.end();
        await shadow.cleanup();
      }
    } finally {
      await Promise.all([source.drop(), target.drop()]);
    }
  }, 120_000);

  test("manifest mismatches fail closed before planning", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_mm");
    const dir = mkdtempSync(join(tmpdir(), "pgdn-fe-manifest-"));
    try {
      const files: SqlFile[] = [
        { name: "t.sql", sql: "CREATE TABLE public.t (id int);\n" },
      ];
      writeExportManifest(dir, {
        redactSecrets: true,
        profile: "supabase",
        scope: "database",
        baselineDigest: "deadbeef",
      });
      const manifest = readExportManifest(dir);
      expect(
        planSchemaFiles(target.pool, target.pool, files, {
          profile: rawProfile,
          scope: "database",
          ...(manifest !== undefined ? { manifest } : {}),
        }),
      ).rejects.toThrow(/profile|baseline/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await target.drop();
    }
  }, 90_000);

  test("pool/shadow cleanup occurs on success and on plan failure", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_cln");
    try {
      const shadow = await provisionCoLocatedShadow(target.uri, {
        uniqueSuffix: `cln_${Date.now().toString(36)}`,
      });
      const name = shadow.name;
      const sp = new pg.Pool({ connectionString: shadow.url, max: 5 });
      try {
        expect(
          planSchemaFiles(target.pool, sp, [{ name: "c.sql", sql: "--\n" }], {
            profile: rawProfile,
            scope: "database",
          }),
        ).rejects.toThrow(/no executable SQL/);
      } finally {
        await sp.end();
        await shadow.cleanup();
      }
      const check = await target.cluster.adminPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_database WHERE datname = $1`,
        [name],
      );
      expect(check.rows[0]?.n).toBe(0);

      const shadow2 = await provisionCoLocatedShadow(target.uri, {
        uniqueSuffix: `ok2_${Date.now().toString(36)}`,
      });
      const name2 = shadow2.name;
      await shadow2.cleanup();
      const check2 = await target.cluster.adminPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_database WHERE datname = $1`,
        [name2],
      );
      expect(check2.rows[0]?.n).toBe(0);
    } finally {
      await target.drop();
    }
  }, 90_000);

  test("ShadowProvisionError when role lacks CREATEDB", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_nocreate");
    const role = `nocreatedb_${Date.now().toString(36)}`;
    try {
      await target.cluster.adminPool.query(
        `CREATE ROLE ${role} LOGIN PASSWORD 'x' NOSUPERUSER NOCREATEDB`,
      );
      const u = new URL(target.uri);
      u.username = role;
      u.password = "x";
      expect(provisionCoLocatedShadow(u.toString())).rejects.toBeInstanceOf(
        ShadowProvisionError,
      );
    } finally {
      await target.cluster.adminPool
        .query(`DROP ROLE IF EXISTS ${role}`)
        .catch(() => {});
      await target.drop();
    }
  }, 90_000);
});
