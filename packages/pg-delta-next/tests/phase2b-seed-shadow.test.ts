/**
 * Phase 2b (#41): `schema apply` with no `--shadow` provisions a co-located
 * throwaway database on the target's own cluster (quick mode). A user
 * declarative dir routinely references PLATFORM objects that pg-delta does not
 * manage under a profile — e.g. `CREATE TRIGGER … ON auth.users` under
 * `--profile supabase`, where the supabase policy keeps `auth.users`
 * reference-only. Loading such a dir into a FRESH shadow fails: `auth.users`
 * does not exist there. Phase 2b seeds the target's assumed-schema objects into
 * the shadow BEFORE loading the user files, so the load resolves and the diff
 * stays symmetric (the seeded objects re-extract reference-only and cancel).
 *
 * The target uses a STAND-IN `auth` schema (like supabase-dsl-e2e.test.ts): the
 * supabase policy keys on the schema NAME, not realness, so a hand-created
 * `auth.users` is reference-only exactly as the real one is. (The committed
 * base-init fixture is the bare→full diff and only replays into the bare image's
 * own `postgres` db — its leading `DROP INDEX "auth".…` fails against a fresh
 * `createDb`, so it is unusable as a per-test target here.) Gated by
 * `runSupabaseBareTests`. A second test proves the seed is INERT for the `raw`
 * profile (no assumedSchemas) and runs on any cluster.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import {
  runSupabaseBareTests,
  sharedCluster,
  supabaseCluster,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe.skipIf(!runSupabaseBareTests)(
  "phase 2b: co-located shadow seed",
  () => {
    test("seeds assumed schemas so a user trigger on auth.users applies in quick mode", async () => {
      const cluster = await supabaseCluster();
      const target = await cluster.createDb("phase2b_seed_tgt");
      dbs.push(target);
      // stand-in platform table: reference-only under the supabase policy.
      await target.pool.query(
        `CREATE SCHEMA auth;\n` +
          `CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);\n`,
      );

      // user declarative dir: a public function + a trigger on the PLATFORM
      // table auth.users (reference-only under --profile supabase). Nothing here
      // creates auth.users — the seed must materialize it in the shadow.
      const dir = join(tmpdir(), `pg-delta-next-phase2b-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_fn.sql"),
        `CREATE FUNCTION public.handle_new_user() RETURNS trigger\n` +
          `  LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;\n`,
      );
      writeFileSync(
        join(dir, "02_trigger.sql"),
        `CREATE TRIGGER on_auth_user_created\n` +
          `  AFTER INSERT ON auth.users\n` +
          `  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();\n`,
      );

      // NO --shadow: co-located quick mode. RED before Phase 2b: the fresh
      // shadow has no auth.users, so loadSqlFiles cannot converge and this
      // rejects with a ShadowLoadError.
      await cmdSchemaApply([
        "--dir",
        dir,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--profile",
        "supabase",
      ]);

      // the trigger was created on the target's real auth.users
      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace ns ON ns.oid = c.relnamespace
          WHERE ns.nspname = 'auth'
            AND c.relname = 'users'
            AND t.tgname = 'on_auth_user_created'`,
      );
      expect(rows[0]?.n).toBe(1);
    }, 240_000);

    // Q6c (design review): a system extension (pg_graphql ∈
    // SUPABASE_SYSTEM_EXTENSIONS) is hard-pruned from the view — the extension
    // id has no schema, so it is never reference-only and the seed emits no
    // CREATE EXTENSION. Its members (in the `graphql` schema) stay reference-
    // only-skipped; only the empty assumed `graphql` schema is seeded. This pins
    // that an extension-bearing target does not break the seed's batch replay.
    test("applies against a target that also has a system extension installed", async () => {
      const cluster = await supabaseCluster();
      const target = await cluster.createDb("phase2b_seed_ext_tgt");
      dbs.push(target);
      await target.pool.query(
        `CREATE SCHEMA auth;\n` +
          `CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);\n` +
          `CREATE EXTENSION IF NOT EXISTS pg_graphql;\n`,
      );

      const dir = join(tmpdir(), `pg-delta-next-phase2b-ext-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_fn.sql"),
        `CREATE FUNCTION public.handle_new_user() RETURNS trigger\n` +
          `  LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;\n`,
      );
      writeFileSync(
        join(dir, "02_trigger.sql"),
        `CREATE TRIGGER on_auth_user_created\n` +
          `  AFTER INSERT ON auth.users\n` +
          `  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();\n`,
      );

      await cmdSchemaApply([
        "--dir",
        dir,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--profile",
        "supabase",
      ]);

      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace ns ON ns.oid = c.relnamespace
          WHERE ns.nspname = 'auth'
            AND c.relname = 'users'
            AND t.tgname = 'on_auth_user_created'`,
      );
      expect(rows[0]?.n).toBe(1);
    }, 240_000);
  },
);

describe("phase 2b: seed is inert without assumed schemas", () => {
  test("raw profile (no assumedSchemas) applies in quick mode with no seeding", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("phase2b_raw_tgt");
    dbs.push(target);

    const dir = join(tmpdir(), `pg-delta-next-phase2b-raw-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "01_schema.sql"),
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id integer PRIMARY KEY);\n`,
    );

    // NO --shadow, NO --profile → raw profile has no assumedSchemas, so the
    // seed step short-circuits and the co-located load runs exactly as before.
    await cmdSchemaApply([
      "--dir",
      dir,
      "--target",
      target.uri,
      "--renames",
      "off",
    ]);

    const { rows } = await target.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app'`,
    );
    expect(rows[0]?.n).toBe(1);
  }, 90_000);
});
