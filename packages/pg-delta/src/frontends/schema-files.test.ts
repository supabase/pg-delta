/**
 * Pure guards for declarative schema files (empty/comment-only refusal,
 * database-scope cluster-DDL preflight, manifest reconciliation).
 */
import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import {
  planSchemaFiles,
  prepareSchemaFiles,
  reconcileSchemaManifest,
  SchemaFrontendError,
} from "./schema-plan.ts";
import type { ExportManifest } from "./export-manifest.ts";
import type { SqlFile } from "./load-sql-files.ts";
import { rawProfile } from "../integrations/profile.ts";

function files(entries: Record<string, string>): SqlFile[] {
  return Object.entries(entries).map(([name, sql]) => ({ name, sql }));
}

describe("prepareSchemaFiles", () => {
  test("refuses empty / comment-only input (would drop-all)", () => {
    const r = prepareSchemaFiles(files({ "c.sql": "-- just a comment\n" }), {
      scope: "database",
      skipClusterDdl: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("no executable SQL found");
  });

  test("refuses cluster DDL in database scope without skipClusterDdl", () => {
    const r = prepareSchemaFiles(
      files({
        "roles.sql": "CREATE ROLE app;\n",
        "t.sql": "CREATE TABLE public.t (id int);\n",
      }),
      { scope: "database", skipClusterDdl: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("cluster DDL");
  });

  test("refuses an all-cluster-DDL dir after skipClusterDdl", () => {
    const r = prepareSchemaFiles(
      files({ "roles.sql": "CREATE ROLE app;\nALTER ROLE app WITH LOGIN;\n" }),
      { scope: "database", skipClusterDdl: true },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("no executable database-scope SQL remains");
    }
  });

  test("keeps non-cluster SQL when skipClusterDdl leaves real statements", () => {
    const r = prepareSchemaFiles(
      files({
        "1.sql": "CREATE ROLE app;\nCREATE TABLE public.t (id int);\n",
      }),
      { scope: "database", skipClusterDdl: true },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skipped.length).toBeGreaterThan(0);
      expect(r.files.map((f) => f.sql).join("")).toContain("CREATE TABLE");
    }
  });

  test("accepts a normal database-scope dir", () => {
    expect(
      prepareSchemaFiles(
        files({ "t.sql": "CREATE TABLE public.t (id int);\n" }),
        {
          scope: "database",
          skipClusterDdl: false,
        },
      ).ok,
    ).toBe(true);
  });
});

describe("reconcileSchemaManifest", () => {
  test("rejects profile / scope / redaction / baseline / default-owner mismatches", () => {
    const manifest: ExportManifest = {
      profile: "supabase",
      scope: "database",
      redactSecrets: true,
      baselineDigest: "aaaa",
      defaultOwner: "postgres",
    };

    expect(() =>
      reconcileSchemaManifest(manifest, {
        profileId: "raw",
        scope: "database",
        redactSecrets: true,
        baselineDigest: "aaaa",
      }),
    ).toThrow(SchemaFrontendError);

    expect(() =>
      reconcileSchemaManifest(manifest, {
        profileId: "supabase",
        scope: "cluster",
        redactSecrets: true,
        baselineDigest: "aaaa",
      }),
    ).toThrow(/scope/);

    expect(() =>
      reconcileSchemaManifest(manifest, {
        profileId: "supabase",
        scope: "database",
        redactSecrets: false,
        baselineDigest: "aaaa",
      }),
    ).toThrow(/redact/);

    expect(() =>
      reconcileSchemaManifest(manifest, {
        profileId: "supabase",
        scope: "database",
        redactSecrets: true,
        baselineDigest: "bbbb",
      }),
    ).toThrow(/baseline/);

    // Matching values succeed and return the reconciled options.
    const ok = reconcileSchemaManifest(manifest, {
      profileId: "supabase",
      scope: "database",
      redactSecrets: true,
      baselineDigest: "aaaa",
    });
    expect(ok).toMatchObject({
      profileId: "supabase",
      scope: "database",
      redactSecrets: true,
      baselineDigest: "aaaa",
      defaultOwner: "postgres",
    });
  });

  test("defaults scope/profile/redaction from the manifest when flags are omitted", () => {
    const ok = reconcileSchemaManifest(
      {
        profile: "supabase",
        scope: "cluster",
        redactSecrets: false,
        baselineDigest: "digest1",
      },
      {},
    );
    expect(ok.profileId).toBe("supabase");
    expect(ok.scope).toBe("cluster");
    expect(ok.redactSecrets).toBe(false);
    expect(ok.baselineDigest).toBe("digest1");
  });
});

describe("planSchemaFiles identity preflight", () => {
  test("reports target identity permission failures before querying the shadow", async () => {
    let shadowQueries = 0;
    const target = {
      query: async () => {
        throw Object.assign(new Error("permission denied"), { code: "42501" });
      },
    } as unknown as Pool;
    const shadow = {
      query: async () => {
        shadowQueries += 1;
        throw new Error("shadow must not be queried");
      },
    } as unknown as Pool;

    expect(
      planSchemaFiles(
        target,
        shadow,
        [{ name: "schema.sql", sql: "CREATE SCHEMA identity_probe;" }],
        { profile: rawProfile, scope: "database" },
      ),
    ).rejects.toThrow(
      /planSchemaFiles target safety.*GRANT EXECUTE ON FUNCTION pg_catalog\.pg_control_system\(\)/i,
    );
    expect(shadowQueries).toBe(0);
  });
});
