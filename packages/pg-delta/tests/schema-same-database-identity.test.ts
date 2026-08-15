/**
 * Opt-in bypass of the shadow-vs-target "same observed database" refusal.
 *
 * Physically restored shadows (a warm shadow cache rehydrated from a PGDATA
 * snapshot, as the Supabase CLI provisions) inherit the target cluster's
 * system_identifier AND every database OID, so the identity guard cannot tell
 * such a shadow apart from the target and refuses to load declarative SQL.
 * The bypass lets an operator who knows the shadow is a separate server
 * proceed; it is off by default and warns loudly when used.
 *
 * Integration (Postgres via testcontainers).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import { planSchemaFiles, type SqlFile } from "../src/frontends/index.ts";
import { rawProfile } from "../src/integrations/index.ts";
import { createTestDb, sharedCluster } from "./containers.ts";

const FILES: SqlFile[] = [
  {
    name: "schema.sql",
    sql: "CREATE SCHEMA cloned_shadow;\nCREATE TABLE cloned_shadow.items (id integer PRIMARY KEY);\n",
  },
];

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected operation to reject");
}

function sqlDir(name: string, sql: string): string {
  const dir = join(tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "schema.sql"), sql);
  return dir;
}

/** A second URL for the same database with a different endpoint spelling.
 *  `schema apply` rejects a literally identical --shadow/--target endpoint
 *  before it ever observes identities, so reaching the identity guard (the
 *  guard a physically cloned shadow trips, where the endpoints legitimately
 *  differ) requires an alias — the same trick tests/schema-shadow-safety.ts
 *  uses. */
function aliasUri(uri: string): string {
  const alias = new URL(uri);
  alias.hostname = alias.hostname === "localhost" ? "127.0.0.1" : "localhost";
  return alias.toString();
}

describe("planSchemaFiles same-database identity bypass", () => {
  test("refuses by default and names the escape hatch", async () => {
    const db = await createTestDb("same_identity_default");
    try {
      const error = await captureError(
        planSchemaFiles(db.pool, db.pool, FILES, {
          profile: rawProfile,
          scope: "database",
        }),
      );
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(/same observed database/i);
      // The field failure is a physically cloned shadow — the message must say
      // so and name the opt-out, or the operator has no way forward.
      expect(message).toContain("allowSameDatabaseIdentity");
      expect(
        await db.pool.query(
          `SELECT to_regnamespace('cloned_shadow') IS NULL AS absent`,
        ),
      ).toMatchObject({ rows: [{ absent: true }] });
    } finally {
      await db.drop();
    }
  }, 120_000);

  test("proceeds with a warning when the bypass is set", async () => {
    const db = await createTestDb("same_identity_bypass");
    try {
      const warnings: string[] = [];
      const result = await planSchemaFiles(db.pool, db.pool, FILES, {
        profile: rawProfile,
        scope: "database",
        allowSameDatabaseIdentity: true,
        onWarning: (message) => warnings.push(message),
      });
      // The target is extracted before the shadow load, so the loaded objects
      // still show up as planned creations even though both pools share a db.
      expect(result.plan.deltas.length).toBeGreaterThan(0);
      expect(
        await db.pool.query(
          `SELECT to_regnamespace('cloned_shadow') IS NOT NULL AS present`,
        ),
      ).toMatchObject({ rows: [{ present: true }] });
      expect(warnings.some((w) => /same database identity/i.test(w))).toBe(true);
    } finally {
      await db.drop();
    }
  }, 120_000);

  test("the bypass is a no-op when the identities differ", async () => {
    const target = await createTestDb("same_identity_noop_t");
    const shadow = await createTestDb("same_identity_noop_s");
    try {
      const warnings: string[] = [];
      const result = await planSchemaFiles(target.pool, shadow.pool, FILES, {
        profile: rawProfile,
        scope: "database",
        allowSameDatabaseIdentity: true,
        onWarning: (message) => warnings.push(message),
      });
      expect(result.plan.deltas.length).toBeGreaterThan(0);
      expect(warnings.some((w) => /same database identity/i.test(w))).toBe(
        false,
      );
    } finally {
      await target.drop();
      await shadow.drop();
    }
  }, 120_000);
});

describe("schema apply --allow-same-database-identity", () => {
  test("refuses without the flag and names it", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("same_identity_cli_deny");
    try {
      const dir = sqlDir("same-identity-deny", "CREATE SCHEMA cloned_shadow;");
      const error = await captureError(
        cmdSchemaApply([
          "--dir",
          dir,
          "--shadow",
          aliasUri(target.uri),
          "--target",
          target.uri,
          "--dry-run",
        ]),
      );
      expect((error as Error).message).toContain(
        "shadow and target are the same observed database",
      );
      expect((error as Error).message).toContain(
        "--allow-same-database-identity",
      );
    } finally {
      await target.drop();
    }
  }, 120_000);

  test("proceeds with a stderr warning when the flag is passed", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("same_identity_cli_allow");
    const originalWrite = process.stderr.write.bind(process.stderr);
    const captured: string[] = [];
    try {
      const dir = sqlDir("same-identity-allow", "CREATE SCHEMA cloned_shadow;");
      (process.stderr as { write: unknown }).write = (
        chunk: string | Uint8Array,
        ...rest: unknown[]
      ): boolean => {
        captured.push(typeof chunk === "string" ? chunk : String(chunk));
        return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
      };
      await cmdSchemaApply([
        "--dir",
        dir,
        "--shadow",
        aliasUri(target.uri),
        "--target",
        target.uri,
        "--allow-same-database-identity",
        "--dry-run",
      ]);
      expect(
        captured.some((line) => /same database identity/i.test(line)),
      ).toBe(true);
    } finally {
      (process.stderr as { write: unknown }).write = originalWrite;
      await target.drop();
    }
  }, 120_000);
});
