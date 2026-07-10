/**
 * `schema apply` under the default `database` scope must resolve the policy
 * managed view BEFORE it projects the scope out — the same proven-correct order
 * `schema export` uses. The reverse order (project scope first, resolve policy
 * second) strips the `owner` edges that a policy's owner-exclusion rule reads,
 * so a platform object owned by a system role (here an event trigger owned by a
 * non-managed role) is no longer excluded and gets planned for a spurious DROP.
 *
 * Faithful end-to-end regression: it drives the real `cmdSchemaApply`, so the
 * production ordering — not the test — decides whether the object is dropped.
 * The alpine applier is a superuser, so the wrongful DROP EVENT TRIGGER SUCCEEDS
 * rather than failing with "must be owner of event trigger"; we therefore assert
 * on the real catalog state (the event trigger survives) rather than on an error.
 *
 * Docker required. Plain alpine (no Supabase gate) — a custom profile carries an
 * owner-exclusion policy exactly like the Supabase profile's Rule 6.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

describe("schema apply: database-scope owner-exclusion ordering", () => {
  let target: TestDb;
  let sysRole: string;
  const evtName = "owner_excl_placeholder";

  beforeAll(async () => {
    const cluster = await sharedCluster();
    target = await cluster.createDb("owner_excl_tgt");
    // a cluster-global system role that the policy's owner rule excludes; it
    // must be a superuser to own an event trigger. Unique per run so the shared
    // cluster does not collide across test databases.
    sysRole = `owner_excl_sys_${target.name}`;
    await cluster.adminPool.query(`CREATE ROLE "${sysRole}" SUPERUSER`);
    // an event-trigger function (owned by the admin, i.e. managed) plus an event
    // trigger RE-OWNED to the system role, so its `owner` edge points at the role
    // the policy excludes.
    await target.pool.query(`
      CREATE FUNCTION et_fn() RETURNS event_trigger LANGUAGE plpgsql AS $$
        BEGIN END $$;
      CREATE EVENT TRIGGER "${evtName}" ON ddl_command_start
        EXECUTE FUNCTION et_fn();
      ALTER EVENT TRIGGER "${evtName}" OWNER TO "${sysRole}";
    `);
  }, 120_000);

  afterAll(async () => {
    await target.drop();
    await target.cluster.adminPool
      .query(`DROP ROLE IF EXISTS "${sysRole}"`)
      .catch(() => {});
  });

  test("an event trigger owned by an excluded system role is not dropped", async () => {
    const work = mkdtempSync(join(tmpdir(), "pgdelta-owner-excl-"));
    const dir = join(work, "schema");
    mkdirSync(dir, { recursive: true });
    // the declarative desired state: the (managed) event-trigger function, but
    // NOT the event trigger (excluded by the policy) and NOT the system role
    // (unmanaged under database scope). A correct apply is a no-op.
    writeFileSync(
      join(dir, "01_fn.sql"),
      `CREATE FUNCTION et_fn() RETURNS event_trigger LANGUAGE plpgsql AS $$\n  BEGIN END $$;\n`,
    );
    // a custom profile whose policy excludes any object owned by the system role
    // (mirrors the Supabase profile's owner-based Rule 6).
    const profilePath = join(work, "profile.json");
    writeFileSync(
      profilePath,
      JSON.stringify({
        id: "owner-excl",
        handlers: [],
        policy: {
          id: "owner-excl",
          filter: [{ match: { owner: [sysRole] }, action: "exclude" }],
        },
      }),
      "utf8",
    );

    await cmdSchemaApply([
      "--dir",
      dir,
      "--target",
      target.uri,
      "--renames",
      "off",
      "--profile",
      profilePath,
    ]);

    // The excluded event trigger must still exist. RED (project-then-resolve):
    // the owner edge is stripped before the policy runs, so the trigger is not
    // excluded and the superuser applier drops it → count 0. GREEN: the trigger
    // survives → count 1.
    const res = await target.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_event_trigger WHERE evtname = $1`,
      [evtName],
    );
    expect(res.rows[0]?.n).toBe("1");
  }, 120_000);
});
