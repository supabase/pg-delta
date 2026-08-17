/**
 * `schema export` serializes object ownership as `ALTER … OWNER TO` (an assumed
 * role reference, consistent with ACLs) but SUPPRESSES it for the resolved
 * DEFAULT owner so exports stay human-readable. The default resolves:
 *   --default-owner <role|none>  >  profile-declared default  >  database owner (datdba)
 *
 * The manifest stamps the resolved default owner; `schema apply` fails closed
 * (exit 2) when the target connection role differs from a role-name default.
 *
 * Faithful end-to-end regressions driving the real CLI (subprocess) so exit
 * codes and file/manifest output are the production behaviour, not the test's.
 * Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const CLI = join(
  new URL("..", import.meta.url).pathname.replace(/\/$/, ""),
  "src/cli/main.ts",
);
const PKG_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
async function runCli(args: string[]): Promise<SpawnResult> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd: PKG_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

const readManifest = (dir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, ".pgdelta-export.json"), "utf8"));
const readTable = (dir: string, table: string): string =>
  readFileSync(join(dir, `public/tables/${table}.sql`), "utf8");
const readTableIn = (dir: string, schema: string, table: string): string =>
  readFileSync(join(dir, `${schema}/tables/${table}.sql`), "utf8");

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("schema export: default-owner ownership serialization", () => {
  // (a) DEFAULT suppression: an object owned by the datdba (the export
  // connection role) emits no OWNER TO; an object owned by another role does.
  test("(a) suppresses OWNER TO for the datdba default, emits it for others", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expown_a_src");
    dbs.push(src);
    await cluster.adminPool
      .query(`CREATE ROLE exc_owner_a NOLOGIN`)
      .catch(() => {});
    await cluster.adminPool.query(`GRANT exc_owner_a TO test`).catch(() => {});
    await src.pool.query(`
      CREATE TABLE public.t_plain (id int);
      CREATE TABLE public.t_exc (id int);
      ALTER TABLE public.t_exc OWNER TO exc_owner_a;
    `);
    const datdba = (
      await src.pool.query<{ o: string }>(
        `SELECT pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname = current_database()`,
      )
    ).rows[0]!.o;

    const dir = mkdtempSync(join(tmpdir(), "expown-a-"));
    const res = await runCli([
      "schema",
      "export",
      "--source",
      src.uri,
      "--out-dir",
      dir,
    ]);
    expect(res.exitCode).toBe(0);

    expect(readTable(dir, "t_plain")).not.toMatch(/owner to/i);
    expect(readTable(dir, "t_exc")).toMatch(
      /alter table[\s\S]*owner to "?exc_owner_a"?/i,
    );
    expect(readManifest(dir).defaultOwner).toBe(datdba);
  }, 120_000);

  // (b) EXPLICIT flag flips which owner is implicit.
  test("(b) --default-owner <role> makes that role implicit and emits OWNER TO for the datdba", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expown_b_src");
    dbs.push(src);
    await cluster.adminPool
      .query(`CREATE ROLE exc_owner_b NOLOGIN`)
      .catch(() => {});
    await cluster.adminPool.query(`GRANT exc_owner_b TO test`).catch(() => {});
    await src.pool.query(`
      CREATE TABLE public.t_plain (id int);
      CREATE TABLE public.t_exc (id int);
      ALTER TABLE public.t_exc OWNER TO exc_owner_b;
    `);
    const datdba = (
      await src.pool.query<{ o: string }>(
        `SELECT pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname = current_database()`,
      )
    ).rows[0]!.o;

    const dir = mkdtempSync(join(tmpdir(), "expown-b-"));
    const res = await runCli([
      "schema",
      "export",
      "--source",
      src.uri,
      "--out-dir",
      dir,
      "--default-owner",
      "exc_owner_b",
    ]);
    expect(res.exitCode).toBe(0);

    expect(readTable(dir, "t_exc")).not.toMatch(/owner to/i);
    expect(readTable(dir, "t_plain")).toMatch(
      new RegExp(`owner to "?${datdba}"?`, "i"),
    );
    expect(readManifest(dir).defaultOwner).toBe("exc_owner_b");
  }, 120_000);

  // (c) VERBOSE: --default-owner none emits every OWNER TO; manifest null.
  test("(c) --default-owner none emits OWNER TO for every owned object", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expown_c_src");
    dbs.push(src);
    await cluster.adminPool
      .query(`CREATE ROLE exc_owner_c NOLOGIN`)
      .catch(() => {});
    await cluster.adminPool.query(`GRANT exc_owner_c TO test`).catch(() => {});
    await src.pool.query(`
      CREATE TABLE public.t_plain (id int);
      CREATE TABLE public.t_exc (id int);
      ALTER TABLE public.t_exc OWNER TO exc_owner_c;
    `);

    const dir = mkdtempSync(join(tmpdir(), "expown-c-"));
    const res = await runCli([
      "schema",
      "export",
      "--source",
      src.uri,
      "--out-dir",
      dir,
      "--default-owner",
      "none",
    ]);
    expect(res.exitCode).toBe(0);

    expect(readTable(dir, "t_plain")).toMatch(/owner to "?test"?/i);
    expect(readTable(dir, "t_exc")).toMatch(/owner to "?exc_owner_c"?/i);
    expect(readManifest(dir).defaultOwner).toBeNull();
  }, 120_000);
});

describe("schema export/apply: two-role ownership round-trip", () => {
  // (d) source has a default owner A + one object owned by A and one owned by
  // exc_owner; export at database scope; apply to a fresh target connecting as A
  // → zero-action drift on a full-scope re-plan and target ownership ≡ source.
  test("(d) round-trips ownership, guards a divergent applier, and verbose converges", async () => {
    const cluster = await sharedCluster();
    // login roles usable as --target connection roles; superuser so the applier
    // can create the co-located shadow and set any owner.
    await cluster.adminPool
      .query(`CREATE ROLE own_a SUPERUSER LOGIN PASSWORD 'a'`)
      .catch(() => {});
    await cluster.adminPool
      .query(`CREATE ROLE own_c SUPERUSER LOGIN PASSWORD 'c'`)
      .catch(() => {});
    await cluster.adminPool
      .query(`CREATE ROLE own_exc NOLOGIN`)
      .catch(() => {});
    await cluster.adminPool.query(`GRANT own_exc TO own_a`).catch(() => {});
    await cluster.adminPool.query(`GRANT own_a TO own_c`).catch(() => {});
    await cluster.adminPool.query(`GRANT own_exc TO own_c`).catch(() => {});

    const src = await cluster.createDb("expown_d_src");
    dbs.push(src);
    await cluster.adminPool
      .query(`ALTER DATABASE "${src.name}" OWNER TO own_a`)
      .catch(() => {});
    await src.pool.query(`
      CREATE SCHEMA s AUTHORIZATION own_a;
      CREATE TABLE s.t_a (id int);
      ALTER TABLE s.t_a OWNER TO own_a;
      CREATE TABLE s.t_exc (id int);
      ALTER TABLE s.t_exc OWNER TO own_exc;
    `);

    const uriAs = (db: TestDb, role: string, pw: string): string =>
      db.uri.replace("test:test@", `${role}:${pw}@`);

    const dir = mkdtempSync(join(tmpdir(), "expown-d-"));
    // export connecting as admin; datdba(src) === own_a → default owner own_a.
    expect(
      (
        await runCli([
          "schema",
          "export",
          "--source",
          src.uri,
          "--out-dir",
          dir,
        ])
      ).exitCode,
    ).toBe(0);
    expect(readManifest(dir).defaultOwner).toBe("own_a");

    // apply to a fresh target owned by own_a, connecting AS own_a → guard passes.
    const dst = await cluster.createDb("expown_d_dst");
    dbs.push(dst);
    await cluster.adminPool
      .query(`ALTER DATABASE "${dst.name}" OWNER TO own_a`)
      .catch(() => {});
    const applied = await runCli([
      "schema",
      "apply",
      "--dir",
      dir,
      "--target",
      uriAs(dst, "own_a", "a"),
      "--renames",
      "off",
    ]);
    expect({ code: applied.exitCode, stderr: applied.stderr }).toMatchObject({
      code: 0,
    });

    // ownership round-tripped: full-scope (cluster) re-plan is a no-op.
    const [s, d] = await Promise.all([extract(src.pool), extract(dst.pool)]);
    const rePlan = plan(s.factBase, d.factBase);
    expect(rePlan.actions).toEqual([]);
    // direct catalog check for good measure
    const owners = async (db: TestDb) =>
      (
        await db.pool.query<{ rel: string; owner: string }>(
          `SELECT relname AS rel, pg_get_userbyid(relowner) AS owner
             FROM pg_class WHERE relnamespace = 's'::regnamespace AND relkind = 'r'
             ORDER BY relname`,
        )
      ).rows;
    expect(await owners(dst)).toEqual(await owners(src));

    // DIVERGE: applying the same (default-owner own_a) export as own_c ≠ own_a
    // fails closed with exit 2 and names both roles.
    const dst2 = await cluster.createDb("expown_d_dst2");
    dbs.push(dst2);
    await cluster.adminPool
      .query(`ALTER DATABASE "${dst2.name}" OWNER TO own_c`)
      .catch(() => {});
    // baseline the co-located shadow DBs BEFORE the diverged apply so the leak
    // assertion is robust to shadows other (concurrent) test files hold.
    const shadowNames = async (): Promise<string[]> =>
      (
        await cluster.adminPool.query<{ d: string }>(
          `SELECT datname AS d FROM pg_database WHERE datname LIKE 'pgdelta_shadow_%'`,
        )
      ).rows.map((r) => r.d);
    const shadowsBefore = new Set(await shadowNames());
    const diverged = await runCli([
      "schema",
      "apply",
      "--dir",
      dir,
      "--target",
      uriAs(dst2, "own_c", "c"),
      "--renames",
      "off",
    ]);
    expect(diverged.exitCode).toBe(2);
    expect(diverged.stderr).toMatch(/own_a/);
    expect(diverged.stderr).toMatch(/own_c/);
    // NO LEAK: the diverged apply (no --shadow) provisions a co-located shadow
    // BEFORE the owner guard fires; the guard's exit(2) must still drop it.
    // Before the fix, process.exit skipped the cleanup finally → the shadow DB
    // leaked on the target's cluster.
    const leaked = (await shadowNames()).filter((d) => !shadowsBefore.has(d));
    expect(leaked).toEqual([]);

    // VERBOSE: re-export --default-owner none; applying as own_c (member of both
    // own_a and own_exc) converges despite own_c ≠ own_a (every OWNER TO explicit).
    const dirV = mkdtempSync(join(tmpdir(), "expown-dv-"));
    expect(
      (
        await runCli([
          "schema",
          "export",
          "--source",
          src.uri,
          "--out-dir",
          dirV,
          "--default-owner",
          "none",
        ])
      ).exitCode,
    ).toBe(0);
    expect(readManifest(dirV).defaultOwner).toBeNull();

    const dst3 = await cluster.createDb("expown_d_dst3");
    dbs.push(dst3);
    await cluster.adminPool
      .query(`ALTER DATABASE "${dst3.name}" OWNER TO own_c`)
      .catch(() => {});
    const verbose = await runCli([
      "schema",
      "apply",
      "--dir",
      dirV,
      "--target",
      uriAs(dst3, "own_c", "c"),
      "--renames",
      "off",
    ]);
    expect({ code: verbose.exitCode, stderr: verbose.stderr }).toMatchObject({
      code: 0,
    });
    const d3 = await extract(dst3.pool);
    expect(plan(s.factBase, d3.factBase).actions).toEqual([]);
  }, 300_000);
});

// MIDDLEWARE SHAPE (regression for the seeding-path ownership drop): the
// unit/e2e tests above are public-only and extension-free, so `resolveView`
// returns EARLY without reconstructing the fact base. Once an extension (or any
// assumed-schema) is present, `extensionMemberReferenceOnly` is non-empty and
// `resolveView` REBUILDS the base to attach the reference-only marks — a rebuild
// that (before the fix) did not propagate the owner→role `allowDangling` hook and
// silently pruned EVERY retained dangling owner edge, so a database-scope export
// of a DB with extensions emitted ZERO `OWNER TO`. These tests pin that path.
describe("schema export: ownership survives the seeding/member path", () => {
  // (e) an EXTENSION is installed (member facts → resolveView reconstructs), plus
  // a non-public schema+table owned by a role that is neither the connection role
  // nor the default owner. Database-scope export must still emit OWNER TO for it.
  test("(e) emits OWNER TO for a non-default owner when an extension is present", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("expown_e_src");
    dbs.push(src);
    await cluster.adminPool
      .query(`CREATE ROLE exc_owner_e NOLOGIN`)
      .catch(() => {});
    await cluster.adminPool.query(`GRANT exc_owner_e TO test`).catch(() => {});
    await src.pool.query(`
      CREATE EXTENSION pg_trgm;
      CREATE SCHEMA app AUTHORIZATION exc_owner_e;
      CREATE TABLE app.t (id int);
      ALTER TABLE app.t OWNER TO exc_owner_e;
      CREATE TABLE public.t_pub (id int);
    `);
    const datdba = (
      await src.pool.query<{ o: string }>(
        `SELECT pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname = current_database()`,
      )
    ).rows[0]!.o;

    const dir = mkdtempSync(join(tmpdir(), "expown-e-"));
    const res = await runCli([
      "schema",
      "export",
      "--source",
      src.uri,
      "--out-dir",
      dir,
    ]);
    expect(res.exitCode).toBe(0);
    expect(readManifest(dir).defaultOwner).toBe(datdba);
    // the non-default owner's ownership must survive the reconstruction.
    expect(readTableIn(dir, "app", "t")).toMatch(
      /alter table[\s\S]*owner to "?exc_owner_e"?/i,
    );

    // VERBOSE: --default-owner none must keep every owner edge, including the
    // default-owned public table (also dropped by the un-hooked rebuild).
    const dirV = mkdtempSync(join(tmpdir(), "expown-ev-"));
    const resV = await runCli([
      "schema",
      "export",
      "--source",
      src.uri,
      "--out-dir",
      dirV,
      "--default-owner",
      "none",
    ]);
    expect(resV.exitCode).toBe(0);
    expect(readManifest(dirV).defaultOwner).toBeNull();
    expect(readTableIn(dirV, "app", "t")).toMatch(/owner to "?exc_owner_e"?/i);
    expect(readTable(dirV, "t_pub")).toMatch(/owner to "?test"?/i);
  }, 120_000);

  // (f) full round-trip through the seeding path: export a DB with an extension +
  // a non-default-owned object at database scope, apply into a fresh DB as the
  // default owner, re-extract, and assert a full-scope re-plan is a no-op
  // (ownership converged). This is the mission assertion; it must exercise the
  // reconstruction the member facts force.
  test("(f) round-trips ownership through an extension-bearing DB", async () => {
    const cluster = await sharedCluster();
    await cluster.adminPool
      .query(`CREATE ROLE rt_a SUPERUSER LOGIN PASSWORD 'a'`)
      .catch(() => {});
    await cluster.adminPool.query(`CREATE ROLE rt_exc NOLOGIN`).catch(() => {});
    await cluster.adminPool.query(`GRANT rt_exc TO rt_a`).catch(() => {});

    const src = await cluster.createDb("expown_f_src");
    dbs.push(src);
    await cluster.adminPool
      .query(`ALTER DATABASE "${src.name}" OWNER TO rt_a`)
      .catch(() => {});
    await src.pool.query(`
      CREATE EXTENSION pg_trgm;
      CREATE SCHEMA app2 AUTHORIZATION rt_a;
      CREATE TABLE app2.t_a (id int);
      ALTER TABLE app2.t_a OWNER TO rt_a;
      CREATE TABLE app2.t_exc (id int);
      ALTER TABLE app2.t_exc OWNER TO rt_exc;
    `);

    const uriAs = (db: TestDb, role: string, pw: string): string =>
      db.uri.replace("test:test@", `${role}:${pw}@`);

    const dir = mkdtempSync(join(tmpdir(), "expown-f-"));
    expect(
      (
        await runCli([
          "schema",
          "export",
          "--source",
          src.uri,
          "--out-dir",
          dir,
        ])
      ).exitCode,
    ).toBe(0);
    expect(readManifest(dir).defaultOwner).toBe("rt_a");
    // sanity: the non-default owner's ownership is present in the export.
    expect(readTableIn(dir, "app2", "t_exc")).toMatch(/owner to "?rt_exc"?/i);

    const dst = await cluster.createDb("expown_f_dst");
    dbs.push(dst);
    await cluster.adminPool
      .query(`ALTER DATABASE "${dst.name}" OWNER TO rt_a`)
      .catch(() => {});
    const applied = await runCli([
      "schema",
      "apply",
      "--dir",
      dir,
      "--target",
      uriAs(dst, "rt_a", "a"),
      "--renames",
      "off",
    ]);
    expect({ code: applied.exitCode, stderr: applied.stderr }).toMatchObject({
      code: 0,
    });

    const [s, d] = await Promise.all([extract(src.pool), extract(dst.pool)]);
    expect(plan(s.factBase, d.factBase).actions).toEqual([]);
    const owners = async (db: TestDb) =>
      (
        await db.pool.query<{ rel: string; owner: string }>(
          `SELECT relname AS rel, pg_get_userbyid(relowner) AS owner
             FROM pg_class WHERE relnamespace = 'app2'::regnamespace AND relkind = 'r'
             ORDER BY relname`,
        )
      ).rows;
    expect(await owners(dst)).toEqual(await owners(src));
  }, 300_000);
});

const uriAsRole = (db: TestDb, role: string, pw: string): string =>
  db.uri.replace("test:test@", `${role}:${pw}@`);

// FIX ⑤: an explicit --shadow whose connection role differs from the manifest's
// stamped default owner loads the omitted-`OWNER TO` objects as the SHADOW's
// current_user, so the projection (which prunes only edges to the default owner)
// leaves a spurious `ALTER … OWNER TO <shadow user>` in the plan. The guard must
// fire on the explicit-shadow path too, not just the target connection role.
describe("schema apply: explicit --shadow owner guard", () => {
  test("(g) fails closed when an explicit --shadow role differs from the stamped default owner", async () => {
    const cluster = await sharedCluster();
    await cluster.adminPool
      .query(`CREATE ROLE own5_a SUPERUSER LOGIN PASSWORD 'a'`)
      .catch(() => {});
    await cluster.adminPool
      .query(`CREATE ROLE own5_b SUPERUSER LOGIN PASSWORD 'b'`)
      .catch(() => {});

    const src = await cluster.createDb("expown5_src");
    dbs.push(src);
    await cluster.adminPool
      .query(`ALTER DATABASE "${src.name}" OWNER TO own5_a`)
      .catch(() => {});
    await src.pool.query(`
      CREATE SCHEMA s AUTHORIZATION own5_a;
      CREATE TABLE s.t_a (id int);
      ALTER TABLE s.t_a OWNER TO own5_a;
    `);

    // export as admin; datdba(src) === own5_a → manifest default owner own5_a.
    const dir = mkdtempSync(join(tmpdir(), "expown5-"));
    expect(
      (
        await runCli([
          "schema",
          "export",
          "--source",
          src.uri,
          "--out-dir",
          dir,
        ])
      ).exitCode,
    ).toBe(0);
    expect(readManifest(dir).defaultOwner).toBe("own5_a");

    // fresh target owned by own5_a, connecting AS own5_a → target guard passes.
    const dst = await cluster.createDb("expown5_dst");
    dbs.push(dst);
    await cluster.adminPool
      .query(`ALTER DATABASE "${dst.name}" OWNER TO own5_a`)
      .catch(() => {});
    // explicit --shadow database connecting as own5_b ≠ own5_a.
    const shadowDb = await cluster.createDb("expown5_shadow");
    dbs.push(shadowDb);

    const res = await runCli([
      "schema",
      "apply",
      "--dir",
      dir,
      "--target",
      uriAsRole(dst, "own5_a", "a"),
      "--shadow",
      uriAsRole(shadowDb, "own5_b", "b"),
      "--renames",
      "off",
    ]);
    // GREEN: exit 2 BEFORE any shadow load; stderr names both the shadow role
    // and the manifest default owner. RED (pre-fix): the omitted-`OWNER TO`
    // objects load as own5_b, the plan emits `ALTER … OWNER TO own5_b`, apply
    // exits 0 (spurious ownership drift) and s.t_a lands on the target.
    expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
      code: 2,
    });
    expect(res.stderr).toMatch(/own5_b/);
    expect(res.stderr).toMatch(/own5_a/);
    expect(res.stderr).toMatch(/shadow/i);
    // never loaded/applied: the target stayed empty.
    const applied = await dst.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class WHERE relname = 't_a' AND relkind = 'r'`,
    );
    expect(applied.rows[0]?.n).toBe("0");
  }, 300_000);
});

// FIX ⑥: a directory with NO manifest never opted into default-owner
// suppression, so it must be applied VERBOSE — every explicit `OWNER TO` in the
// files is honored. The old behaviour synthesized a default from the target
// profile/datdba and pruned desired owner edges to it, silently dropping an
// explicit `ALTER … OWNER TO <role>` when the target object was owned by a
// different role.
describe("schema apply: manifest-absent directory is verbose", () => {
  test("(h) honors an explicit OWNER TO in a manifest-less dir instead of pruning to a synthesized default", async () => {
    const cluster = await sharedCluster();
    await cluster.adminPool
      .query(`CREATE ROLE own6_a SUPERUSER LOGIN PASSWORD 'a'`)
      .catch(() => {});
    await cluster.adminPool.query(`CREATE ROLE own6_b NOLOGIN`).catch(() => {});
    await cluster.adminPool.query(`GRANT own6_b TO own6_a`).catch(() => {});

    // hand-authored dir: NO manifest file; explicit OWNER TO own6_a.
    const work = mkdtempSync(join(tmpdir(), "expown6-"));
    const dir = join(work, "schema");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "01_t.sql"),
      `CREATE TABLE public.t (id int);\nALTER TABLE public.t OWNER TO own6_a;\n`,
      "utf8",
    );

    // target owned by own6_a (so a synthesized datdba default WOULD be own6_a),
    // with t already existing owned by own6_b (the divergent owner).
    const dst = await cluster.createDb("expown6_dst");
    dbs.push(dst);
    await cluster.adminPool
      .query(`ALTER DATABASE "${dst.name}" OWNER TO own6_a`)
      .catch(() => {});
    await dst.pool.query(`
      CREATE TABLE public.t (id int);
      ALTER TABLE public.t OWNER TO own6_b;
    `);

    const res = await runCli([
      "schema",
      "apply",
      "--dir",
      dir,
      "--target",
      uriAsRole(dst, "own6_a", "a"),
      "--renames",
      "off",
    ]);
    // GREEN: verbose NOTE prints, the old datdba WARNING is gone, and the
    // explicit OWNER TO own6_a is honored → post-apply owner is own6_a. RED
    // (pre-fix): applyDefaultOwner is synthesized to the target datdba (own6_a)
    // and the desired owner edge to own6_a is pruned → owner-unlink only, no
    // ALTER emitted → t stays owned by own6_b.
    expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
      code: 0,
    });
    expect(res.stderr).toMatch(/NOTE:[\s\S]*no default owner/i);
    expect(res.stderr).toMatch(/verbose/i);
    expect(res.stderr).not.toMatch(
      /WARNING: the export directory records no default owner/i,
    );
    const owner = await dst.pool.query<{ o: string }>(
      `SELECT pg_get_userbyid(relowner) AS o FROM pg_class
         WHERE relname = 't' AND relnamespace = 'public'::regnamespace`,
    );
    expect(owner.rows[0]?.o).toBe("own6_a");
  }, 300_000);
});
