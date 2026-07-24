import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import { UsageError } from "../src/cli/flags.ts";
import { sharedCluster } from "./containers.ts";

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

test("schema apply rejects shadow and target URLs for the same database", async () => {
  const cluster = await sharedCluster();
  const target = await cluster.createDb("shadow_guard_same_url");
  try {
    const dir = sqlDir("shadow-guard-same", "CREATE SCHEMA should_not_exist;");
    const error = await captureError(
      cmdSchemaApply([
        "--dir",
        dir,
        "--shadow",
        target.uri,
        "--target",
        target.uri,
      ]),
    );
    expect(error).toBeInstanceOf(UsageError);
    expect(
      await target.pool.query(
        `SELECT to_regnamespace('should_not_exist') IS NULL AS absent`,
      ),
    ).toMatchObject({ rows: [{ absent: true }] });
  } finally {
    await target.drop();
  }
}, 60_000);

test("schema apply observes same-database aliases before loading SQL", async () => {
  const cluster = await sharedCluster();
  const target = await cluster.createDb("shadow_guard_alias");
  try {
    const targetUrl = new URL(target.uri);
    const aliasUrl = new URL(target.uri);
    aliasUrl.hostname =
      targetUrl.hostname === "localhost" ? "127.0.0.1" : "localhost";
    const dir = sqlDir("shadow-guard-alias", "CREATE SCHEMA should_not_exist;");
    const error = await captureError(
      cmdSchemaApply([
        "--dir",
        dir,
        "--shadow",
        aliasUrl.toString(),
        "--target",
        targetUrl.toString(),
      ]),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "shadow and target are the same observed database",
    );
    expect(
      await target.pool.query(
        `SELECT to_regnamespace('should_not_exist') IS NULL AS absent`,
      ),
    ).toMatchObject({ rows: [{ absent: true }] });
  } finally {
    await target.drop();
  }
}, 60_000);

test("cluster scope rejects a sibling database on the target cluster", async () => {
  const cluster = await sharedCluster();
  const target = await cluster.createDb("shadow_guard_cluster_target");
  const shadow = await cluster.createDb("shadow_guard_cluster_shadow");
  const role = `shadow_guard_role_${Date.now()}`;
  try {
    const dir = sqlDir("shadow-guard-cluster", `CREATE ROLE ${role};`);
    const error = await captureError(
      cmdSchemaApply([
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--scope",
        "cluster",
        "--isolated-shadow",
      ]),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "requires a shadow on a different PostgreSQL cluster",
    );
    expect(
      await target.pool.query(
        `SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1`,
        [role],
      ),
    ).toMatchObject({ rows: [{ n: 0 }] });
  } finally {
    await Promise.all([target.drop(), shadow.drop()]);
  }
}, 60_000);

test("schema apply requires explicit data-loss approval before mutating target", async () => {
  const cluster = await sharedCluster();
  const target = await cluster.createDb("shadow_guard_data_loss_target");
  const shadow = await cluster.createDb("shadow_guard_data_loss_shadow");
  try {
    await target.pool.query(`
      CREATE SCHEMA app;
      CREATE TABLE app.keep_me (id integer);
      INSERT INTO app.keep_me VALUES (42);
    `);
    const dir = sqlDir("shadow-guard-data-loss", "CREATE SCHEMA app;");
    const error = await captureError(
      cmdSchemaApply([
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
      ]),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("without --allow-data-loss");
    expect(await target.pool.query(`SELECT * FROM app.keep_me`)).toMatchObject({
      rows: [{ id: 42 }],
    });
  } finally {
    await Promise.all([target.drop(), shadow.drop()]);
  }
}, 60_000);
