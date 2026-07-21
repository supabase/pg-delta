/**
 * A snapshot captured from a database WITH a column-level grant
 * (`GRANT SELECT (col) ON t TO r` → `pg_attribute.attacl`) must be re-loadable.
 * The encoder appends an optional `.column` segment to `acl` stable-ids
 * (`acl:(table:...).grantee.column`); the parser must consume it. Before the
 * fix the parser stopped after the grantee and rejected the trailing `.column`
 * as "trailing input", so `drift` (which re-parses every id in the snapshot
 * JSON via loadSnapshot → parseId) could not load such a snapshot at all.
 *
 * This pins the end-to-end path: snapshot a column-granted DB, then diff the
 * same DB against that snapshot → the snapshot loads and reports NO drift.
 *
 * Docker required.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdDrift } from "../src/cli/commands/drift.ts";
import { cmdSnapshot } from "../src/cli/commands/snapshot.ts";
import { type TestDb, sharedCluster } from "./containers.ts";

let db: TestDb;
let snapshotPath: string;

beforeAll(async () => {
  const cluster = await sharedCluster();
  db = await cluster.createDb("colgrant_snap");
  await db.pool.query(`
    DO $$ BEGIN CREATE ROLE colgrant_snap_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA app;
    CREATE TABLE app.t (a int, b int);
    GRANT SELECT (a) ON TABLE app.t TO colgrant_snap_reader;
  `);
  const work = mkdtempSync(join(tmpdir(), "pgdelta-colgrant-snap-"));
  snapshotPath = join(work, "snap.json");
  await cmdSnapshot(["--source", db.uri, "--out", snapshotPath]);
}, 120_000);

afterAll(async () => {
  await db.pool
    .query(`DROP ROLE IF EXISTS colgrant_snap_reader`)
    .catch(() => {});
  await db.drop();
});

describe("column-level grant snapshot round-trip", () => {
  test("drift loads a snapshot with a column-qualified ACL and reports no drift", async () => {
    // Before the parser fix, loadSnapshot(snapshotPath) threw
    //   parseId: trailing input ... in 'acl:(table:app.t).colgrant_snap_reader.a'
    // and cmdDrift rejected. After the fix the snapshot loads and, because it is
    // diffed against the very DB it was captured from, there is no drift → the
    // command resolves normally (exit 0, no CliExit thrown).
    let driftError: unknown;
    try {
      await cmdDrift(["--env", db.uri, "--snapshot", snapshotPath]);
    } catch (e) {
      driftError = e;
    }
    expect(driftError).toBeUndefined();
  }, 120_000);
});
