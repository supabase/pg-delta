/**
 * #370: the Supabase platform creates the `supabase_realtime` publication at
 * project init (owned by `postgres`), and users only manage its MEMBERSHIP via
 * `ALTER PUBLICATION … ADD TABLE`. Under `--profile supabase`:
 *
 *   - `schema export` must NOT rewrite that state as `CREATE PUBLICATION
 *     supabase_realtime …` — only the membership `ALTER`s are the user's.
 *   - `schema apply` with files that omit the publication must NOT plan
 *     `DROP PUBLICATION supabase_realtime` (only rel-grain membership drift).
 *   - the co-located shadow seed must materialize the assumed publication so a
 *     user dir containing `ALTER PUBLICATION supabase_realtime ADD TABLE …`
 *     loads into the otherwise-empty shadow.
 *
 * Docker required. Uses a plain container + the real supabasePolicy (like
 * export-reference-only-parent.test.ts): the policy keys on the publication
 * NAME, not on the Supabase image, so a hand-created `supabase_realtime` is
 * treated exactly as the platform one.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { deriveAssumedSchemaSeed } from "../src/frontends/seed-assumed-schemas.ts";
import { plan } from "../src/plan/plan.ts";
import { flattenPolicy, resolveView } from "../src/policy/policy.ts";
import { supabasePolicy } from "../src/policy/supabase.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

const flat = flattenPolicy(supabasePolicy);

/** A target that mirrors the #370 reproduction: the platform-provided
 *  publication (created empty, owned by postgres) plus a user table added to
 *  it, and a user-created publication as the over-exclusion control. */
async function makeTarget(prefix: string): Promise<TestDb> {
  const cluster = await sharedCluster();
  const db = await cluster.createDb(prefix);
  dbs.push(db);
  await db.pool.query(`
    CREATE PUBLICATION supabase_realtime;
    CREATE TABLE public.pgdelta_pub_t (id integer);
    ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.pgdelta_pub_t;
    CREATE PUBLICATION user_pub FOR TABLE public.pgdelta_pub_t;
  `);
  return db;
}

describe("supabase profile: platform publication supabase_realtime (#370)", () => {
  test("export emits membership ALTERs, never CREATE PUBLICATION supabase_realtime", async () => {
    const db = await makeTarget("pub370_export");
    const { factBase } = await extract(db.pool);
    const view = resolveView(factBase, supabasePolicy);
    const files = exportSqlFiles(view, {
      assumedSchemas: flat.assumedSchemas,
      assumedRoles: flat.assumedRoles,
    });

    const allSql = files.map((f) => f.sql).join("\n");
    // the platform publication object is not ours to recreate ...
    expect(allSql).not.toMatch(/CREATE PUBLICATION "?supabase_realtime"?/i);
    // ... but the user's membership on it IS exported, filed with publications
    const pubFile = files.find((f) => f.name === "cluster/publications.sql");
    expect(pubFile?.sql).toMatch(
      /ALTER PUBLICATION "supabase_realtime" ADD TABLE/,
    );
    // the user-created publication still exports whole (no over-exclusion)
    expect(pubFile?.sql).toMatch(/CREATE PUBLICATION "user_pub"/);
    // filled at GREEN (bun test -u): pins the exact file shape
    expect(pubFile?.sql).toMatchInlineSnapshot();
  }, 120_000);

  test("plan with files omitting the publication drops membership, not the publication", async () => {
    const target = await makeTarget("pub370_plan_tgt");
    // desired: what a shadow loaded from user files that never mention the
    // publication looks like — just the table.
    const cluster = await sharedCluster();
    const desiredDb = await cluster.createDb("pub370_plan_des");
    dbs.push(desiredDb);
    await desiredDb.pool.query(`CREATE TABLE public.pgdelta_pub_t (id integer);`);

    const source = resolveView(
      (await extract(target.pool)).factBase,
      supabasePolicy,
    );
    const desired = resolveView(
      (await extract(desiredDb.pool)).factBase,
      supabasePolicy,
    );
    const sqls = plan(source, desired, {
      policy: supabasePolicy,
      renames: "off",
    }).actions.map((a) => a.sql);

    expect(sqls.some((s) => /DROP PUBLICATION "?supabase_realtime"?/i.test(s))).toBe(
      false,
    );
    expect(
      sqls.some((s) =>
        /ALTER PUBLICATION "supabase_realtime" DROP TABLE/i.test(s),
      ),
    ).toBe(true);
    // the user publication is managed drift and still drops
    expect(sqls.some((s) => /DROP PUBLICATION "?user_pub"?/i.test(s))).toBe(true);
  }, 120_000);

  test("the co-located shadow seed materializes the assumed publication", async () => {
    const db = await makeTarget("pub370_seed");
    const { factBase } = await extract(db.pool);
    const seed = deriveAssumedSchemaSeed(factBase, {
      policy: supabasePolicy,
      assumedSchemas: flat.assumedSchemas,
      assumedRoles: flat.assumedRoles,
    });
    // created EMPTY (membership facts are managed, not assumed) with the
    // platform's publish options
    expect(seed.sql).toMatch(/CREATE PUBLICATION "supabase_realtime"/);
    expect(seed.sql).not.toMatch(/ADD TABLE|FOR TABLE/i);
    // the user publication is managed state and must NOT be seeded
    expect(seed.sql).not.toMatch(/user_pub/);
  }, 120_000);

  test("schema apply: a membership-only declarative dir loads and converges", async () => {
    const target = await makeTarget("pub370_apply");

    // The exported shape after the fix: the table plus a bare membership ALTER
    // — nothing creates the publication; the seed must provide it in the shadow.
    const dir = join(tmpdir(), `pg-delta-pub370-${Date.now()}`);
    mkdirSync(join(dir, "cluster"), { recursive: true });
    mkdirSync(join(dir, "schemas", "public", "tables"), { recursive: true });
    writeFileSync(
      join(dir, "schemas", "public", "tables", "pgdelta_pub_t.sql"),
      `CREATE TABLE public.pgdelta_pub_t (id integer);\n`,
    );
    writeFileSync(
      join(dir, "cluster", "publications.sql"),
      `ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.pgdelta_pub_t;\n\n` +
        `CREATE PUBLICATION user_pub FOR TABLE ONLY public.pgdelta_pub_t WITH (publish = 'insert, update, delete, truncate');\n`,
    );

    // RED before the fix: the fresh shadow has no supabase_realtime, so the
    // ALTER PUBLICATION line can never elaborate and the load fails.
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

    // converged: publication still exists, membership intact, nothing dropped
    const { rows } = await target.pool.query<{
      pubname: string;
      tables: string[];
    }>(`
      SELECT p.pubname,
             coalesce(array_agg(pt.tablename::text) FILTER (WHERE pt.tablename IS NOT NULL), '{}') AS tables
        FROM pg_publication p
        LEFT JOIN pg_publication_tables pt ON pt.pubname = p.pubname
       GROUP BY p.pubname ORDER BY p.pubname
    `);
    expect(rows).toEqual([
      { pubname: "supabase_realtime", tables: ["pgdelta_pub_t"] },
      { pubname: "user_pub", tables: ["pgdelta_pub_t"] },
    ]);
  }, 240_000);
});
