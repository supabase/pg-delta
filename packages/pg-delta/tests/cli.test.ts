/**
 * CLI integration tests (stage-9 deliverable 5/7/8).
 * Spawns the CLI with Bun.spawn and asserts observable behaviour.
 *
 * All tests use the sharedCluster() fixture from containers.ts.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { loadSnapshot } from "../src/frontends/snapshot-file.ts";
import { serializeSnapshot } from "../src/core/snapshot.ts";
import { extract } from "../src/extract/extract.ts";
import { parsePlan, serializePlan } from "../src/plan/artifact.ts";
import { plan } from "../src/plan/plan.ts";
import type { Policy } from "../src/policy/policy.ts";
import { isolatedClusterPair, sharedCluster } from "./containers.ts";

const PKG_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CLI = join(PKG_DIR, "src/cli/main.ts");

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function expectDryRunStdoutIsScript(stdout: string): void {
  for (const diagnostic of [
    "Dry run:",
    "WARNING:",
    "Plan artifact written",
    "UNREDACTED",
  ]) {
    expect(stdout).not.toContain(diagnostic);
  }
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

const SCHEMA_SQL = `
  CREATE SCHEMA clitest;
  CREATE TABLE clitest.items (
    id serial PRIMARY KEY,
    name text NOT NULL
  );
  CREATE INDEX items_name_idx ON clitest.items (name);
`;

describe("CLI: error → exit-code mapping (main is the sole exiter)", () => {
  test("a post-parse usage error maps to exit 2 with its message on stderr", async () => {
    // `--no-format` + `--format-options` is a post-parse guard in cmdSchemaExport
    // that used to `process.stderr.write(...) + process.exit(2)`. It now throws
    // UsageError, which main() maps to exit 2 while writing the message. The
    // guard runs before any DB connection, so the bogus --source is never dialed.
    const res = await runCli([
      "schema",
      "export",
      "--source",
      "postgres://unused.invalid:5432/nope",
      "--out-dir",
      join(tmpdir(), `pgdn-exitmap-${Date.now()}`),
      "--no-format",
      "--format-options",
      "{}",
    ]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/mutually exclusive/);
  });

  test("an unknown flag (parse-time usage error) maps to exit 2", async () => {
    const res = await runCli([
      "snapshot",
      "--source",
      "postgres://unused.invalid:5432/nope",
      "--out",
      join(tmpdir(), `pgdn-exitmap-${Date.now()}.json`),
      "--totally-unknown-flag",
    ]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/Unknown flag/);
    // the command-specific usage hint still rides along on the same message
    expect(res.stderr).toMatch(/Usage: pgdelta snapshot/);
  });
});

describe("CLI: --help", () => {
  test("does not recommend apply --force for unsafe plans", async () => {
    const res = await runCli(["--help"]);
    expect(res.exitCode).toBe(0);
    // RED before the fix: help said an unredacted plan "requires apply --force".
    // apply/prove now re-extract with the plan's stamped redaction mode.
    expect(res.stdout).not.toMatch(/requires\s+"?apply --force/i);
    expect(res.stdout).toContain("re-extract");
  }, 30_000);

  test("lists projection-audit flags on the prove usage line", async () => {
    const res = await runCli(["--help"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(
      /prove\s+--plan <plan\.json> --clone <pg-url> --desired-snapshot <file> \[--strict-audit\] \[--audit-all\]/,
    );
  }, 30_000);
});

describe("CLI: --version", () => {
  // No container needed — argv-only path.
  const PKG_VERSION = (
    JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;

  test("--version prints the package version and exits 0", async () => {
    const res = await runCli(["--version"]);
    // RED before the fix: no version flag, so this fell through to the default
    // branch — "Unknown command: --version" on stderr, exit 2.
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe(PKG_VERSION);
    expect(res.stderr).not.toContain("Unknown command");
  }, 30_000);

  test("-v and version are aliases for --version", async () => {
    for (const arg of ["-v", "version"]) {
      const res = await runCli([arg]);
      expect({ arg, code: res.exitCode }).toMatchObject({ code: 0 });
      expect(res.stdout.trim()).toBe(PKG_VERSION);
    }
  }, 30_000);
});

describe("CLI: schema --help", () => {
  // No container needed — argv-only path.
  test("schema --help prints schema usage to stdout and exits 0", async () => {
    const res = await runCli(["schema", "--help"]);
    // RED before the fix: `schema --help` hit the unknown-subcommand branch,
    // printing "Unknown schema subcommand: --help" on stderr and exiting 2.
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("schema export");
    expect(res.stdout).toContain("schema apply");
    expect(res.stdout).toContain("schema lint");
    expect(res.stderr).not.toContain("Unknown schema subcommand");
  }, 30_000);

  test("schema -h and schema help are aliases", async () => {
    for (const arg of ["-h", "help"]) {
      const res = await runCli(["schema", arg]);
      expect({ arg, code: res.exitCode }).toMatchObject({ code: 0 });
      expect(res.stdout).toContain("schema export");
    }
  }, 30_000);

  test("an unknown schema subcommand still errors (exit 2)", async () => {
    const res = await runCli(["schema", "bogus"]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("Unknown schema subcommand");
  }, 30_000);
});

describe("CLI: prove redaction guard", () => {
  test("rejects a snapshot whose redaction mode differs from the plan (before touching the clone)", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_prove_guard");
    try {
      await source.pool.query(SCHEMA_SQL);

      // a DEFAULT-redacted plan (no --unsafe-show-secrets) → redactSecrets:true
      const planFile = join(tmpdir(), `pgdn-prove-plan-${Date.now()}.json`);
      const planned = await runCli([
        "plan",
        "--source",
        source.uri,
        "--desired",
        source.uri,
        "--out",
        planFile,
      ]);
      expect(planned.exitCode).toBe(0);

      // an UNSAFE snapshot (redactSecrets:false) — mismatched mode
      const snapFile = join(tmpdir(), `pgdn-prove-snap-${Date.now()}.json`);
      const snapped = await runCli([
        "snapshot",
        "--source",
        source.uri,
        "--out",
        snapFile,
        "--unsafe-show-secrets",
      ]);
      expect(snapped.exitCode).toBe(0);

      // clone URL is never dialed — the guard exits before opening it.
      const res = await runCli([
        "prove",
        "--plan",
        planFile,
        "--clone",
        "postgres://unused.invalid:5432/nope",
        "--desired-snapshot",
        snapFile,
      ]);
      // RED before the fix: prove would proceed, mutate the clone, and only then
      // fail the proof spuriously on placeholder-vs-real secrets.
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 2,
      });
      expect(res.stderr).toMatch(/redaction mode/i);
    } finally {
      await source.drop();
    }
  }, 60_000);

  test("treats an unstamped (pre-metadata) snapshot as redacted and rejects an unsafe plan", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_prove_unstamped");
    try {
      await source.pool.query(SCHEMA_SQL);

      // an UNSAFE plan (redactSecrets:false)
      const planFile = join(tmpdir(), `pgdn-prove-unsafe-${Date.now()}.json`);
      expect(
        (
          await runCli([
            "plan",
            "--source",
            source.uri,
            "--desired",
            source.uri,
            "--out",
            planFile,
            "--unsafe-show-secrets",
          ])
        ).exitCode,
      ).toBe(0);

      // a snapshot with the redactSecrets field STRIPPED (simulating one written
      // before the metadata existed) — deserializes with redactSecrets undefined.
      const snapFile = join(
        tmpdir(),
        `pgdn-prove-unstamped-${Date.now()}.json`,
      );
      expect(
        (await runCli(["snapshot", "--source", source.uri, "--out", snapFile]))
          .exitCode,
      ).toBe(0);
      const doc = JSON.parse(readFileSync(snapFile, "utf8"));
      delete doc.redactSecrets; // digest excludes it, so the file stays valid
      writeFileSync(snapFile, JSON.stringify(doc), "utf8");

      const res = await runCli([
        "prove",
        "--plan",
        planFile,
        "--clone",
        "postgres://unused.invalid:5432/nope",
        "--desired-snapshot",
        snapFile,
      ]);
      // RED before the fix: undefined snapshot mode skipped the guard, so prove
      // proceeded and would fail spuriously after mutating the clone.
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 2,
      });
      expect(res.stderr).toMatch(/redaction mode/i);
    } finally {
      await source.drop();
    }
  }, 60_000);
});

describe("CLI: prove projection audit", () => {
  test("prints suspicious suppressions informationally by default and blocks in strict mode", async () => {
    const cluster = await sharedCluster();
    const clone = await cluster.createDb("cli_prove_audit_clone");
    const desired = await cluster.createDb("cli_prove_audit_desired");
    const artifactDir = mkdtempSync(join(tmpdir(), "pgdn-prove-audit-"));
    try {
      await clone.pool.query(`CREATE SCHEMA app`);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.ignored ();
      `);
      const [sourceState, desiredState] = await Promise.all([
        extract(clone.pool),
        extract(desired.pool),
      ]);
      const policy: Policy = {
        id: "generic",
        filter: [{ match: { kind: "table" }, action: "exclude" }],
      };
      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        policy,
      });
      const planFile = join(artifactDir, "plan.json");
      const snapshotFile = join(artifactDir, "desired.snapshot");
      writeFileSync(planFile, serializePlan(thePlan), "utf8");
      writeFileSync(
        snapshotFile,
        serializeSnapshot(desiredState.factBase, {
          pgVersion: "17",
          redactSecrets: true,
        }),
        "utf8",
      );

      const args = [
        "prove",
        "--plan",
        planFile,
        "--clone",
        clone.uri,
        "--desired-snapshot",
        snapshotFile,
      ];
      const informational = await runCli(args);
      expect(informational.exitCode).toBe(0);
      expect(informational.stderr).toMatch(
        /Projection audit: [1-9]\d* suppressed differences? \([1-9]\d* suspicious/,
      );
      expect(informational.stderr).toContain("add table:app.ignored");
      expect(informational.stderr).toContain("policyScopeRule");
      expect(informational.stderr).toContain("Proof passed");

      const legacyPlan = structuredClone(thePlan);
      delete legacyPlan.projectionAudit;
      writeFileSync(planFile, serializePlan(legacyPlan), "utf8");
      const legacyInformational = await runCli(args);
      expect(legacyInformational.exitCode).toBe(0);
      expect(legacyInformational.stderr).toContain(
        "Projection audit: unavailable for this legacy plan; re-plan.",
      );
      expect(legacyInformational.stderr).not.toContain(
        "Projection audit: 0 suppressed differences",
      );

      const legacyStrict = await runCli([...args, "--strict-audit"]);
      expect(legacyStrict.exitCode).toBe(1);
      expect(legacyStrict.stderr).toContain(
        "strict projection audit failed: this legacy plan has no projection audit",
      );

      writeFileSync(planFile, serializePlan(thePlan), "utf8");
      const strict = await runCli([...args, "--strict-audit"]);
      expect(strict.exitCode).toBe(1);
      expect(strict.stderr).toMatch(
        /Projection audit: [1-9]\d* suppressed differences? \([1-9]\d* suspicious/,
      );
      expect(strict.stderr).toContain("Proof FAILED");
    } finally {
      try {
        rmSync(artifactDir, { recursive: true, force: true });
      } finally {
        await Promise.all([clone.drop(), desired.drop()]);
      }
    }
  }, 60_000);
});

describe("CLI: snapshot", () => {
  test("snapshot writes a loadable file whose rootHash round-trips", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_snap_src");
    try {
      await source.pool.query(SCHEMA_SQL);

      const outFile = join(
        tmpdir(),
        `pg-delta-next-snapshot-${Date.now()}.json`,
      );
      const result = await runCli([
        "snapshot",
        "--source",
        source.uri,
        "--out",
        outFile,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Snapshot saved");

      // round-trip: loadSnapshot should give the same rootHash
      const { factBase } = loadSnapshot(outFile);
      expect(factBase.facts().length).toBeGreaterThan(0);

      // verify the hash is stable (the file is a valid snapshot)
      const { factBase: factBase2 } = loadSnapshot(outFile);
      expect(factBase2.rootHash).toBe(factBase.rootHash);
    } finally {
      await source.drop();
    }
  }, 60_000);
});

describe("CLI: diff", () => {
  test("diff between two prepared DBs prints expected kinds", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_diff_src");
    const desired = await cluster.createDb("cli_diff_dst");
    try {
      await source.pool.query(SCHEMA_SQL);
      // desired has one extra table
      await desired.pool.query(`
          ${SCHEMA_SQL}
          CREATE TABLE clitest.extras (id serial PRIMARY KEY);
        `);

      const result = await runCli([
        "diff",
        "--source",
        source.uri,
        "--desired",
        desired.uri,
      ]);

      expect(result.exitCode).toBe(0);
      // extras table is an add delta
      expect(result.stdout).toContain("ADD");
      expect(result.stdout).toContain("table");
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});

describe("CLI: drift", () => {
  test("drift exits 0 when env matches snapshot, exits 1 after mutation", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_drift_src");
    try {
      await source.pool.query(SCHEMA_SQL);

      // take a snapshot of the current state
      const snapshotFile = join(
        tmpdir(),
        `pg-delta-next-drift-${Date.now()}.json`,
      );
      const snapResult = await runCli([
        "snapshot",
        "--source",
        source.uri,
        "--out",
        snapshotFile,
      ]);
      expect(snapResult.exitCode).toBe(0);

      // drift against the same DB — should be no drift
      const nodrif = await runCli([
        "drift",
        "--env",
        source.uri,
        "--snapshot",
        snapshotFile,
      ]);
      expect(nodrif.exitCode).toBe(0);
      expect(nodrif.stdout).toContain("No drift");

      // mutate the DB
      await source.pool.query(`CREATE TABLE clitest.new_table (id integer);`);

      // drift again — should detect the new table
      const hasdrift = await runCli([
        "drift",
        "--env",
        source.uri,
        "--snapshot",
        snapshotFile,
      ]);
      expect(hasdrift.exitCode).toBe(1);
      expect(hasdrift.stdout).toContain("Drift detected");
    } finally {
      await source.drop();
    }
  }, 60_000);
});

describe("CLI: plan", () => {
  test("plan writes a parseable artifact whose actions are non-empty", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_plan_src");
    const desired = await cluster.createDb("cli_plan_dst");
    try {
      // source is empty; desired has a schema
      await desired.pool.query(SCHEMA_SQL);

      const planFile = join(tmpdir(), `pg-delta-next-plan-${Date.now()}.json`);
      const result = await runCli([
        "plan",
        "--source",
        source.uri,
        "--desired",
        desired.uri,
        "--out",
        planFile,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("actions:");

      // parse the artifact
      const { readFileSync } = await import("node:fs");
      const { parsePlan } = await import("../src/plan/artifact.ts");
      const json = readFileSync(planFile, "utf8");
      const thePlan = parsePlan(json);

      expect(thePlan.actions.length).toBeGreaterThan(0);
      expect(thePlan.formatVersion).toBe(1);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("plan stamps the profile id; apply rejects a contradicting --profile (P2)", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_profile_src");
    const desired = await cluster.createDb("cli_profile_dst");
    try {
      await desired.pool.query(SCHEMA_SQL);
      const planFile = join(
        tmpdir(),
        `pg-delta-next-profilestamp-${Date.now()}.json`,
      );
      // default profile is raw → the artifact is stamped { id: "raw" }
      const planned = await runCli([
        "plan",
        "--source",
        source.uri,
        "--desired",
        desired.uri,
        "--out",
        planFile,
      ]);
      expect(planned.exitCode).toBe(0);

      const { readFileSync } = await import("node:fs");
      const { parsePlan } = await import("../src/plan/artifact.ts");
      const thePlan = parsePlan(readFileSync(planFile, "utf8"));
      expect(thePlan.profile).toEqual({ id: "raw" });

      // applying a raw-stamped plan with --profile supabase is a mismatch and
      // must be rejected (exit 2) BEFORE opening the target connection.
      const mismatch = await runCli([
        "apply",
        "--plan",
        planFile,
        "--target",
        source.uri,
        "--profile",
        "supabase",
      ]);
      expect(mismatch.exitCode).toBe(2);
      expect(mismatch.stderr).toMatch(/does not match the plan's profile/);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});

describe("CLI: strict coverage (unmodeled-kind surfacing)", () => {
  // a user CAST is a kind the engine does not model — it must be surfaced, and
  // --strict-coverage must refuse to plan rather than silently omit it.
  const UNMODELED_DDL = `
    CREATE DOMAIN clipostal AS text;
    CREATE FUNCTION clipostal_to_int(clipostal) RETURNS integer
      LANGUAGE sql IMMUTABLE AS 'SELECT length($1)';
    CREATE CAST (clipostal AS integer) WITH FUNCTION clipostal_to_int(clipostal);
  `;

  test("plan surfaces the unmodeled warning; --strict-coverage refuses to plan", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_strict_src");
    const desired = await cluster.createDb("cli_strict_dst");
    try {
      await desired.pool.query(UNMODELED_DDL);

      // default: the warning is surfaced on stderr but the plan still succeeds
      const warn = await runCli([
        "plan",
        "--source",
        source.uri,
        "--desired",
        desired.uri,
      ]);
      expect(warn.exitCode).toBe(0);
      expect(warn.stderr).toContain("unmodeled");
      expect(warn.stderr).toContain("cast");

      // strict: refuses to plan, exits non-zero, names the reason
      const strict = await runCli([
        "plan",
        "--source",
        source.uri,
        "--desired",
        desired.uri,
        "--strict-coverage",
      ]);
      expect(strict.exitCode).toBe(3);
      expect(strict.stderr).toContain("unmodeled");
      expect(strict.stderr.toLowerCase()).toContain("strict-coverage");
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 90_000);
});

describe("CLI: schema export --scope", () => {
  test("database scope omits cluster/roles.sql; cluster scope includes it", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_export_scope_src");
    try {
      await source.pool.query(SCHEMA_SQL);
      const { existsSync } = await import("node:fs");
      const scopeOf = (dir: string) =>
        JSON.parse(readFileSync(join(dir, ".pgdelta-export.json"), "utf8"))
          .scope;

      // default (database): the connection role's CREATE ROLE is projected out,
      // so no cluster/roles.sql — the dir reloads on any cluster.
      const dbDir = join(tmpdir(), `pgdn-exp-scope-db-${Date.now()}`);
      expect(
        (
          await runCli([
            "schema",
            "export",
            "--source",
            source.uri,
            "--out-dir",
            dbDir,
          ])
        ).exitCode,
      ).toBe(0);
      expect(existsSync(join(dbDir, "cluster/roles.sql"))).toBe(false);
      expect(scopeOf(dbDir)).toBe("database");

      // cluster scope keeps roles.
      const clDir = join(tmpdir(), `pgdn-exp-scope-cl-${Date.now()}`);
      expect(
        (
          await runCli([
            "schema",
            "export",
            "--source",
            source.uri,
            "--out-dir",
            clDir,
            "--scope",
            "cluster",
          ])
        ).exitCode,
      ).toBe(0);
      expect(existsSync(join(clDir, "cluster/roles.sql"))).toBe(true);
      expect(scopeOf(clDir)).toBe("cluster");
    } finally {
      await source.drop();
    }
  }, 90_000);
});

describe("CLI: schema export", () => {
  test("schema export writes files to disk including schemas/<s>/tables/<t>.sql", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_export_src");
    try {
      await source.pool.query(SCHEMA_SQL);

      const outDir = join(tmpdir(), `pg-delta-next-export-${Date.now()}`);
      mkdirSync(outDir, { recursive: true });

      const result = await runCli([
        "schema",
        "export",
        "--source",
        source.uri,
        "--out-dir",
        outDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Exported");

      // verify expected file exists
      const { existsSync } = await import("node:fs");
      expect(existsSync(join(outDir, "schemas/clitest/tables/items.sql"))).toBe(
        true,
      );
    } finally {
      await source.drop();
    }
  }, 60_000);

  test("re-export removes the stale file of a dropped object", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_reexport_src");
    try {
      await source.pool.query(SCHEMA_SQL);
      await source.pool.query(
        `CREATE TABLE clitest.gone (id integer PRIMARY KEY);`,
      );

      const outDir = join(tmpdir(), `pg-delta-next-reexport-${Date.now()}`);
      mkdirSync(outDir, { recursive: true });
      const args = [
        "schema",
        "export",
        "--source",
        source.uri,
        "--out-dir",
        outDir,
      ];

      expect((await runCli(args)).exitCode).toBe(0);
      const { existsSync } = await import("node:fs");
      const goneFile = join(outDir, "schemas/clitest/tables/gone.sql");
      expect(existsSync(goneFile)).toBe(true);

      // drop the object and re-export into the SAME dir.
      await source.pool.query(`DROP TABLE clitest.gone;`);
      const re = await runCli(args);
      expect(re.exitCode).toBe(0);

      // RED before the fix: the loop only overwrote new paths, so gone.sql
      // lingered and `schema apply --dir` would reload the dropped table.
      expect(existsSync(goneFile)).toBe(false);
      expect(existsSync(join(outDir, "schemas/clitest/tables/items.sql"))).toBe(
        true,
      );
    } finally {
      await source.drop();
    }
  }, 90_000);
});

// REVIEW_HANDOFF.md P1: schema export/apply must be profile-aware like `plan`,
// instead of always using the raw view — otherwise SQL-file workflows diverge
// from the profile-aware DB-to-DB path. These prove the `--profile` /
// `--restrict-to-applier` flags exist and thread through extract/plan/apply.
describe("CLI: schema apply --scope database (ambient roles)", () => {
  test("does not create shadow-only nor drop target-only cluster roles", async () => {
    // shadow and target on SEPARATE clusters (the real deployment: local shadow,
    // remote target), each with a distinct ambient role the declarative files
    // never mention.
    const [shadowCluster, targetCluster] = await isolatedClusterPair();
    const shadow = await shadowCluster.createDb("cli_scope_shadow");
    const target = await targetCluster.createDb("cli_scope_tgt");
    const shadowRole = `only_on_shadow_${Date.now()}`;
    const targetRole = `only_on_target_${Date.now()}`;
    try {
      await shadow.pool.query(`CREATE ROLE ${shadowRole} NOLOGIN`);
      await target.pool.query(`CREATE ROLE ${targetRole} NOLOGIN`);

      const dir = join(tmpdir(), `pg-delta-next-scope-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_schema.sql"),
        `CREATE SCHEMA app;\nCREATE TABLE app.t (id integer PRIMARY KEY);\n`,
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
      ]);

      // RED before the fix: database scope did not project roles, so the plan
      // CREATEd the shadow-only role on the target AND DROPped the target-only
      // role (destructive). Now roles are ambient — neither happens.
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      const has = async (role: string) =>
        (
          await target.pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1`,
            [role],
          )
        ).rows[0]?.n === 1;
      expect(await has(targetRole)).toBe(true); // NOT dropped
      expect(await has(shadowRole)).toBe(false); // NOT created
      // the actual schema objects DID apply
      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app'`,
      );
      expect(rows[0]?.n).toBe(1);
    } finally {
      await shadow.pool
        .query(`DROP ROLE IF EXISTS ${shadowRole}`)
        .catch(() => {});
      await target.pool
        .query(`DROP ROLE IF EXISTS ${targetRole}`)
        .catch(() => {});
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 120_000);

  test("rejects cluster DDL in files under database scope (with escapes)", async () => {
    const dir = join(tmpdir(), `pg-delta-next-clusterddl-${Date.now()}`);
    mkdirSync(join(dir, "cluster"), { recursive: true });
    writeFileSync(join(dir, "01_schema.sql"), `CREATE SCHEMA app;\n`);
    writeFileSync(
      join(dir, "cluster", "roles.sql"),
      `CREATE ROLE app_owner NOLOGIN;\nGRANT app_owner TO current_user;\n`,
    );
    // rejected before any connection (default scope is database)
    const res = await runCli([
      "schema",
      "apply",
      "--dir",
      dir,
      "--shadow",
      "postgres://unused.invalid:5432/s",
      "--target",
      "postgres://unused.invalid:5432/t",
    ]);
    expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
      code: 2,
    });
    expect(res.stderr).toMatch(/does not manage cluster-global roles/i);
    expect(res.stderr).toContain("CREATE ROLE");
    expect(res.stderr).toMatch(/--skip-cluster-ddl/);
  }, 30_000);

  test("--skip-cluster-ddl drops role DDL and applies the rest", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_skipddl_shadow");
    const target = await cluster.createDb("cli_skipddl_tgt");
    const skipRole = `skip_role_${Date.now()}`;
    try {
      const dir = join(tmpdir(), `pg-delta-next-skipddl-${Date.now()}`);
      mkdirSync(join(dir, "cluster"), { recursive: true });
      writeFileSync(
        join(dir, "01_schema.sql"),
        `CREATE SCHEMA app;\nCREATE TABLE app.t (id integer PRIMARY KEY);\n`,
      );
      writeFileSync(
        join(dir, "cluster", "roles.sql"),
        `CREATE ROLE ${skipRole} NOLOGIN;\n`,
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--skip-cluster-ddl",
      ]);
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      expect(res.stderr).toMatch(/SKIP cluster DDL/i);
      // schema applied; the skipped role was NOT created
      const tbl = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app'`,
      );
      expect(tbl.rows[0]?.n).toBe(1);
      const role = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1`,
        [skipRole],
      );
      expect(role.rows[0]?.n).toBe(0);
    } finally {
      await shadow.pool
        .query(`DROP ROLE IF EXISTS ${skipRole}`)
        .catch(() => {});
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 90_000);

  test("rejects --scope contradicting the export manifest scope", async () => {
    const dir = join(tmpdir(), `pg-delta-next-scope-conflict-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "01_schema.sql"), `CREATE SCHEMA app;\n`);
    writeFileSync(
      join(dir, ".pgdelta-export.json"),
      JSON.stringify({ formatVersion: 1, scope: "cluster" }),
      "utf8",
    );
    // reconciled before any connection is opened
    const res = await runCli([
      "schema",
      "apply",
      "--dir",
      dir,
      "--shadow",
      "postgres://unused.invalid:5432/s",
      "--target",
      "postgres://unused.invalid:5432/t",
      "--scope",
      "database",
    ]);
    expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
      code: 2,
    });
    expect(res.stderr).toMatch(/contradicts the export manifest scope/i);
  }, 30_000);

  test("co-located quick mode (no --shadow) provisions and drops a shadow on the target cluster", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("cli_colocated_tgt");
    try {
      const dir = join(tmpdir(), `pg-delta-next-colocated-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_schema.sql"),
        `CREATE SCHEMA app;\nCREATE TABLE app.t (id integer PRIMARY KEY);\n`,
      );

      // NO --shadow: a co-located shadow database is created on the target cluster.
      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--target",
        target.uri,
        "--renames",
        "off",
      ]);
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      const m = /Created shadow database (pgdelta_shadow_\S+)/.exec(res.stderr);
      expect(m).not.toBeNull();
      const shadowName = m![1] as string;

      // the schema applied to the target ...
      const { rows: tbl } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app'`,
      );
      expect(tbl[0]?.n).toBe(1);
      // ... and the throwaway shadow database was dropped.
      const { rows: db } = await target.pool.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [shadowName],
      );
      expect(db).toHaveLength(0);
    } finally {
      await target.drop();
    }
  }, 90_000);

  test("--scope cluster requires --isolated-shadow", async () => {
    const res = await runCli([
      "schema",
      "apply",
      "--dir",
      tmpdir(),
      "--shadow",
      "postgres://unused.invalid:5432/s",
      "--target",
      "postgres://unused.invalid:5432/t",
      "--scope",
      "cluster",
    ]);
    // validated before any connection is opened
    expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
      code: 2,
    });
    expect(res.stderr).toMatch(/isolated-shadow/i);
  }, 30_000);
});

describe("CLI: schema apply guards", () => {
  test("refuses an empty --dir instead of planning to drop everything", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_empty_shadow");
    const target = await cluster.createDb("cli_empty_tgt");
    try {
      await target.pool.query(SCHEMA_SQL); // target HAS managed objects
      const emptyDir = join(tmpdir(), `pg-delta-next-emptydir-${Date.now()}`);
      mkdirSync(emptyDir, { recursive: true });

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        emptyDir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
      ]);
      // RED before the fix: apply loaded an empty shadow and planned to DROP the
      // target's schema/tables. Now it aborts with exit 2.
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 2,
      });
      expect(res.stderr).toMatch(/no executable SQL/i);
      // the target's objects are untouched
      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'clitest'`,
      );
      expect(rows[0]?.n).toBe(1);
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 60_000);

  test("refuses a directory whose only .sql is comment-only", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_commentonly_shadow");
    const target = await cluster.createDb("cli_commentonly_tgt");
    try {
      await target.pool.query(SCHEMA_SQL); // target HAS managed objects
      const dir = join(tmpdir(), `pg-delta-next-commentonly-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      // a placeholder file with no executable SQL (line + block comments only)
      writeFileSync(
        join(dir, "01_note.sql"),
        `-- just a placeholder\n/* nothing to apply here */\n`,
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
      ]);
      // RED before the fix: the filename count was > 0, so apply loaded an empty
      // shadow and planned to drop the target's objects. Now it aborts (exit 2).
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 2,
      });
      expect(res.stderr).toMatch(/no executable SQL/i);
      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'clitest'`,
      );
      expect(rows[0]?.n).toBe(1);
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 60_000);

  test("refuses to apply a profiled export under a contradicting --profile", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_profile_guard_shadow");
    const target = await cluster.createDb("cli_profile_guard_tgt");
    try {
      // a directory whose manifest was written by `schema export --profile supabase`
      const dir = join(tmpdir(), `pg-delta-next-profile-guard-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "01_schema.sql"), `CREATE SCHEMA app;\n`);
      writeFileSync(
        join(dir, ".pgdelta-export.json"),
        JSON.stringify({
          formatVersion: 1,
          redactSecrets: true,
          profile: "supabase",
        }),
        "utf8",
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--profile",
        "raw",
        "--renames",
        "off",
      ]);
      // RED before the fix: the manifest profile was ignored, so a raw apply of a
      // supabase export proceeded (and could drop platform state). Now the
      // mismatch is rejected up front (exit 2), before opening a connection.
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 2,
      });
      expect(res.stderr).toMatch(/profile/i);
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 60_000);
});

describe("CLI: schema profile-awareness", () => {
  test("schema export --profile raw is accepted (raw == identity)", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_exp_profile_src");
    try {
      await source.pool.query(SCHEMA_SQL);
      const outDir = join(tmpdir(), `pg-delta-next-exp-prof-${Date.now()}`);
      mkdirSync(outDir, { recursive: true });
      const result = await runCli([
        "schema",
        "export",
        "--source",
        source.uri,
        "--out-dir",
        outDir,
        "--profile",
        "raw",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Exported");
      const { existsSync } = await import("node:fs");
      expect(existsSync(join(outDir, "schemas/clitest/tables/items.sql"))).toBe(
        true,
      );
    } finally {
      await source.drop();
    }
  }, 60_000);

  test("schema apply --profile raw --restrict-to-applier applies SQL files", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_apply_prof_shadow");
    const target = await cluster.createDb("cli_apply_prof_tgt");
    try {
      // hand-written declarative files (no serial/role cycles — those are an
      // orthogonal export-layout concern). The point is that the profile flags
      // thread through extraction, planning, and apply.
      const dir = join(tmpdir(), `pg-delta-next-apply-prof-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(dir, "01_schema.sql"), `CREATE SCHEMA clitest;\n`);
      writeFileSync(
        join(dir, "02_table.sql"),
        `CREATE TABLE clitest.items (id integer PRIMARY KEY, name text NOT NULL);\n`,
      );

      const applied = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--profile",
        "raw",
        "--restrict-to-applier",
        "--renames",
        "off",
      ]);
      expect({ code: applied.exitCode, stderr: applied.stderr }).toMatchObject({
        code: 0,
      });
      expect(applied.stderr).toMatch(/Applied \d+ action/);

      // the target now has the declared schema + table
      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'clitest'`,
      );
      expect(rows[0]?.n).toBe(1);
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 90_000);
});

// A declarative dir with cluster-level role state trips the default
// databaseScratch leak guard; --isolated-shadow (dedicated shadow cluster) lets
// it load (review P2).
describe("CLI: schema apply --scope cluster --isolated-shadow", () => {
  test("role-containing export reloads and creates the role under cluster scope", async () => {
    const [shadowCluster, targetCluster] = await isolatedClusterPair();
    const shadow = await shadowCluster.createDb("cli_iso_shadow");
    const target = await targetCluster.createDb("cli_iso_tgt");
    try {
      const dir = join(tmpdir(), `pg-delta-next-iso-${Date.now()}`);
      mkdirSync(join(dir, "cluster"), { recursive: true });
      writeFileSync(
        join(dir, "cluster/roles.sql"),
        `CREATE ROLE cli_iso_role_xyz NOLOGIN;\n`,
      );

      // cluster scope MANAGES roles; --isolated-shadow gives the dedicated shadow
      // cluster that lets the CREATE ROLE load past the leak guard. (Under the
      // default database scope the role is ambient and would NOT be created.)
      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--scope",
        "cluster",
        "--isolated-shadow",
      ]);

      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      const { rows } = await target.pool.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cli_iso_role_xyz') AS exists`,
      );
      expect(rows[0]?.exists).toBe(true);
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 120_000);
});

// The reorder assist is on by default (target-arch §4.4.1) but must NOT silently
// degrade the desired state. Two cases force a fall back to raw, file-granular
// loading (review P1).
describe("CLI: schema apply reorder safety", () => {
  test("a pg-topo parse error falls back to raw loading and surfaces the bad file (no silent drop)", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_reorder_pe_shadow");
    const target = await cluster.createDb("cli_reorder_pe_tgt");
    try {
      const dir = join(tmpdir(), `pg-delta-next-reorder-pe-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "01_good.sql"), `CREATE SCHEMA clitest;\n`);
      // Unparseable: pg-topo returns a PARSE_ERROR and NO statement nodes for
      // this file, so a reorder would silently OMIT it from the shadow.
      writeFileSync(
        join(dir, "02_bad.sql"),
        `CREATE TABLE clitest.broken (id int;\n`,
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
      ]);

      // RED before the fix: the bad file is dropped, the shadow builds from the
      // good file only, and apply exits 0 — silently ignoring 02_bad.sql.
      expect(res.stderr).toContain("reorder assist disabled");
      expect(res.exitCode).not.toBe(0);
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 90_000);

  test("ALTER DEFAULT PRIVILEGES files warn that raw load may apply ADP after same-load objects", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_reorder_adp_shadow");
    const target = await cluster.createDb("cli_reorder_adp_tgt");
    try {
      const dir = join(tmpdir(), `pg-delta-next-reorder-adp-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "01_schema.sql"), `CREATE SCHEMA app;\n`);
      writeFileSync(
        join(dir, "02_adp.sql"),
        `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO PUBLIC;\n`,
      );
      writeFileSync(
        join(dir, "03_table.sql"),
        `CREATE TABLE app.widget (id integer PRIMARY KEY);\n`,
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
      ]);

      expect(res.exitCode).toBe(0);
      // ADP present → reorder disabled, raw load, and the caveat is surfaced (no
      // silent limitation): objects relying on ADP-implicit grants may miss them.
      expect(res.stderr).toContain("reorder assist disabled");
      expect(res.stderr).toMatch(
        /raw loading may apply ALTER DEFAULT PRIVILEGES AFTER objects/i,
      );
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 90_000);

  test("--no-reorder still warns about ADP raw-load ordering (every raw path)", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_noreorder_adp_shadow");
    const target = await cluster.createDb("cli_noreorder_adp_tgt");
    try {
      const dir = join(tmpdir(), `pg-delta-next-noreorder-adp-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "01_schema.sql"), `CREATE SCHEMA app;\n`);
      writeFileSync(
        join(dir, "02_adp.sql"),
        `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO PUBLIC;\n`,
      );
      writeFileSync(
        join(dir, "03_table.sql"),
        `CREATE TABLE app.widget (id integer PRIMARY KEY);\n`,
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--no-reorder",
      ]);

      expect(res.exitCode).toBe(0);
      // --no-reorder skips the diagnostics branch entirely (no "reorder assist
      // disabled"), but the ADP caveat must STILL surface on this raw path.
      expect(res.stderr).not.toContain("reorder assist disabled");
      expect(res.stderr).toMatch(
        /raw loading may apply ALTER DEFAULT PRIVILEGES AFTER objects/i,
      );
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 90_000);

  test("session-setting statements force raw loading, not reorder", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_reorder_ss_shadow");
    const target = await cluster.createDb("cli_reorder_ss_tgt");
    try {
      const dir = join(tmpdir(), `pg-delta-next-reorder-ss-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "01_schema.sql"), `CREATE SCHEMA app;\n`);
      writeFileSync(
        join(dir, "02_set.sql"),
        `SET search_path TO app, public;\nCREATE TABLE app.widget (id integer PRIMARY KEY);\n`,
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
      ]);

      // RED before the fix: stderr shows "Reordered into N statement(s)" and no
      // fallback warning — the SET barrier was reordered.
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      expect(res.stderr).toContain("reorder assist disabled");
      expect(res.stderr).toContain("session-setting");
      expect(res.stderr).not.toContain("Reordered into");

      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app'`,
      );
      expect(rows[0]?.n).toBe(1);
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 90_000);
});

describe("CLI: secret redaction surface", () => {
  // Custom FDW (NO HANDLER/VALIDATOR) accepts arbitrary option keys, so we can
  // plant a credential in a server option on stock alpine.
  const FDW_SQL = `
    CREATE FOREIGN DATA WRAPPER cli_redact_fdw;
    CREATE SERVER cli_redact_srv FOREIGN DATA WRAPPER cli_redact_fdw
      OPTIONS (host 'h.example.com', password 'cli-secret-xyz');
  `;

  test("snapshot redacts by default; --unsafe-show-secrets emits real values + warns", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_redact_src");
    try {
      await source.pool.query(FDW_SQL);

      // default: redacted, no warning
      const redactedFile = join(tmpdir(), `pgdn-redact-${Date.now()}.json`);
      const r1 = await runCli([
        "snapshot",
        "--source",
        source.uri,
        "--out",
        redactedFile,
      ]);
      expect(r1.exitCode).toBe(0);
      const redacted = readFileSync(redactedFile, "utf8");
      expect(redacted).not.toContain("cli-secret-xyz");
      expect(redacted).toContain("__OPTION_PASSWORD__");
      expect(r1.stderr).not.toContain("Secret redaction is DISABLED");

      // opt-out: real value emitted, loud warning on stderr
      const rawFile = join(tmpdir(), `pgdn-raw-${Date.now()}.json`);
      const r2 = await runCli([
        "snapshot",
        "--source",
        source.uri,
        "--out",
        rawFile,
        "--unsafe-show-secrets",
      ]);
      expect(r2.exitCode).toBe(0);
      const raw = readFileSync(rawFile, "utf8");
      expect(raw).toContain("cli-secret-xyz");
      expect(raw).not.toContain("__OPTION_PASSWORD__");
      expect(r2.stderr).toContain("Secret redaction is DISABLED");
    } finally {
      await source.drop();
    }
  }, 60_000);

  test("schema apply --unsafe-show-secrets round-trips real credentials to the target", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_apply_secret_shadow");
    const target = await cluster.createDb("cli_apply_secret_tgt");
    try {
      // a declarative dir carrying a REAL credential (e.g. produced by
      // `schema export --unsafe-show-secrets`).
      const dir = join(tmpdir(), `pg-delta-next-apply-secret-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_fdw.sql"),
        `CREATE FOREIGN DATA WRAPPER cli_apply_fdw;\n` +
          `CREATE SERVER cli_apply_srv FOREIGN DATA WRAPPER cli_apply_fdw\n` +
          `  OPTIONS (host 'h.example.com', password 'apply-secret-xyz');\n`,
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--unsafe-show-secrets",
      ]);

      // RED before the fix: the shadow re-extract redacts the credential, so the
      // plan emits OPTIONS (... '__OPTION_PASSWORD__') and the target stores the
      // placeholder instead of the real value.
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      expect(res.stderr).toContain("Secret redaction is DISABLED");

      const { rows } = await target.pool.query<{ srvoptions: string[] }>(
        `SELECT srvoptions FROM pg_foreign_server WHERE srvname = 'cli_apply_srv'`,
      );
      const opts = (rows[0]?.srvoptions ?? []).join(",");
      expect(opts).toContain("password=apply-secret-xyz");
      expect(opts).not.toContain("__OPTION_PASSWORD__");
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 90_000);

  test("schema apply --unsafe-show-secrets passes the fingerprint gate when the target already has secrets", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_fp_shadow");
    const target = await cluster.createDb("cli_fp_tgt");
    try {
      // the TARGET already holds an unredacted credential, so the plan source
      // fingerprint is computed over an unredacted fact base.
      await target.pool.query(FDW_SQL);

      // declarative dir matches the target's server but adds a new object, so
      // there is a non-empty plan whose apply triggers the fingerprint gate.
      const dir = join(tmpdir(), `pg-delta-next-fp-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_fdw.sql"),
        `CREATE FOREIGN DATA WRAPPER cli_redact_fdw;\n` +
          `CREATE SERVER cli_redact_srv FOREIGN DATA WRAPPER cli_redact_fdw\n` +
          `  OPTIONS (host 'h.example.com', password 'cli-secret-xyz');\n`,
      );
      writeFileSync(join(dir, "02_schema.sql"), `CREATE SCHEMA fp_extra;\n`);

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--unsafe-show-secrets",
      ]);

      // RED before the fix: apply's re-extract for the fingerprint still redacts,
      // so it mismatches the unredacted plan source and the gate aborts (exit 1)
      // unless --force is passed.
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      expect(res.stderr).not.toContain("fingerprint");
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 90_000);

  test("plan --unsafe-show-secrets then apply passes the fingerprint gate (artifact carries redaction mode)", async () => {
    const cluster = await sharedCluster();
    // `target` is the apply target (plan's --source); `desired` is the goal.
    const target = await cluster.createDb("cli_plan_fp_tgt");
    const desired = await cluster.createDb("cli_plan_fp_desired");
    try {
      // both hold the SAME unredacted credential, so the plan source fingerprint
      // is over an unredacted fact base; `desired` adds a schema so the plan is
      // non-empty and apply runs the fingerprint gate.
      await target.pool.query(FDW_SQL);
      await desired.pool.query(FDW_SQL);
      await desired.pool.query(`CREATE SCHEMA fp_extra;`);

      const planFile = join(tmpdir(), `pgdn-plan-fp-${Date.now()}.json`);
      const planRes = await runCli([
        "plan",
        "--source",
        target.uri,
        "--desired",
        desired.uri,
        "--renames",
        "off",
        "--out",
        planFile,
        "--unsafe-show-secrets",
      ]);
      expect(planRes.exitCode).toBe(0);
      // the plan ran with redaction disabled, so its source fingerprint is over
      // the unredacted server option (the secret is folded into the hash, not
      // serialized into the artifact's diff).
      expect(planRes.stderr).toContain("Secret redaction is DISABLED");

      const applyRes = await runCli([
        "apply",
        "--plan",
        planFile,
        "--target",
        target.uri,
      ]);

      // RED before the fix: the artifact does not record redactSecrets and apply
      // re-extracts the target with default redaction, so the placeholder-vs-real
      // fingerprint mismatch aborts the gate (exit 1) without --force.
      expect({
        code: applyRes.exitCode,
        stderr: applyRes.stderr,
      }).toMatchObject({ code: 0 });
      const { rows } = await target.pool.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'fp_extra') AS exists`,
      );
      expect(rows[0]?.exists).toBe(true);
    } finally {
      await Promise.all([target.drop(), desired.drop()]);
    }
  }, 120_000);

  test("snapshot --unsafe-show-secrets then drift reports no drift for an unchanged secret (mode derived from the snapshot)", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_drift_secret");
    try {
      await source.pool.query(FDW_SQL);

      const snapFile = join(tmpdir(), `pgdn-drift-secret-${Date.now()}.json`);
      const snap = await runCli([
        "snapshot",
        "--source",
        source.uri,
        "--out",
        snapFile,
        "--unsafe-show-secrets",
      ]);
      expect(snap.exitCode).toBe(0);

      // drift WITHOUT re-passing --unsafe-show-secrets: the mode must be derived
      // from the snapshot, so the unredacted server option is compared against an
      // equally-unredacted live extract.
      const drift = await runCli([
        "drift",
        "--env",
        source.uri,
        "--snapshot",
        snapFile,
      ]);
      // RED before the fix: drift defaults to a redacted live extract, so the
      // real-vs-placeholder server option shows as spurious drift (exit 1).
      expect({ code: drift.exitCode, stdout: drift.stdout }).toMatchObject({
        code: 0,
      });
      expect(drift.stdout).toContain("No drift");
    } finally {
      await source.drop();
    }
  }, 90_000);

  test("schema export records its redaction mode in a manifest", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_export_manifest_src");
    try {
      await source.pool.query(FDW_SQL);
      const { existsSync } = await import("node:fs");
      const manifestOf = (dir: string) =>
        JSON.parse(readFileSync(join(dir, ".pgdelta-export.json"), "utf8"));

      const redactedDir = join(tmpdir(), `pgdn-exp-red-${Date.now()}`);
      expect(
        (
          await runCli([
            "schema",
            "export",
            "--source",
            source.uri,
            "--out-dir",
            redactedDir,
          ])
        ).exitCode,
      ).toBe(0);
      expect(existsSync(join(redactedDir, ".pgdelta-export.json"))).toBe(true);
      expect(manifestOf(redactedDir).redactSecrets).toBe(true);
      // the projection profile is recorded too (default is raw)
      expect(manifestOf(redactedDir).profile).toBe("raw");

      const unsafeDir = join(tmpdir(), `pgdn-exp-unsafe-${Date.now()}`);
      expect(
        (
          await runCli([
            "schema",
            "export",
            "--source",
            source.uri,
            "--out-dir",
            unsafeDir,
            "--unsafe-show-secrets",
          ])
        ).exitCode,
      ).toBe(0);
      expect(manifestOf(unsafeDir).redactSecrets).toBe(false);
    } finally {
      await source.drop();
    }
  }, 90_000);

  test("schema apply honors the export manifest's unsafe mode without --unsafe-show-secrets", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_manifest_apply_shadow");
    const target = await cluster.createDb("cli_manifest_apply_tgt");
    try {
      // a declarative dir carrying a REAL credential plus a manifest recording
      // the unsafe mode (as `schema export --unsafe-show-secrets` would write).
      const dir = join(tmpdir(), `pg-delta-next-manifest-apply-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_fdw.sql"),
        `CREATE FOREIGN DATA WRAPPER cli_manifest_fdw;\n` +
          `CREATE SERVER cli_manifest_srv FOREIGN DATA WRAPPER cli_manifest_fdw\n` +
          `  OPTIONS (host 'h.example.com', password 'manifest-secret-xyz');\n`,
      );
      writeFileSync(
        join(dir, ".pgdelta-export.json"),
        JSON.stringify({ formatVersion: 1, redactSecrets: false }),
        "utf8",
      );

      // NOTE: no --unsafe-show-secrets flag — the manifest must drive the mode.
      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
      ]);
      // RED before the fix: apply re-extracted redacted, so the target stored
      // '__OPTION_PASSWORD__' instead of the exported credential.
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      expect(res.stderr).toContain("Secret redaction is DISABLED");

      const { rows } = await target.pool.query<{ srvoptions: string[] }>(
        `SELECT srvoptions FROM pg_foreign_server WHERE srvname = 'cli_manifest_srv'`,
      );
      const opts = (rows[0]?.srvoptions ?? []).join(",");
      expect(opts).toContain("password=manifest-secret-xyz");
      expect(opts).not.toContain("__OPTION_PASSWORD__");
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 120_000);

  test("schema apply warns before verbose output exposes manifest-unredacted secrets", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_verbose_secret_shadow");
    const target = await cluster.createDb("cli_verbose_secret_tgt");
    const secret = "verbose-secret-xyz";
    try {
      const dir = join(tmpdir(), `pg-delta-next-verbose-secret-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_fdw.sql"),
        `CREATE FOREIGN DATA WRAPPER cli_verbose_fdw;\n` +
          `CREATE SERVER cli_verbose_srv FOREIGN DATA WRAPPER cli_verbose_fdw\n` +
          `  OPTIONS (host 'h.example.com', password '${secret}');\n`,
      );
      writeFileSync(
        join(dir, ".pgdelta-export.json"),
        JSON.stringify({ formatVersion: 1, redactSecrets: false }),
        "utf8",
      );

      // No --unsafe-show-secrets flag: the export manifest disables redaction.
      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--verbose",
      ]);

      expect(res.exitCode).toBe(0);
      const warningText =
        "WARNING: secrets are unredacted (--unsafe-show-secrets or the export manifest) — the verbose output contains UNREDACTED credentials.";
      expect(res.stderr).toContain(warningText);
      const warningLine =
        res.stderr.split("\n").find((line) => line.includes(warningText)) ?? "";
      expect(warningLine).not.toContain(secret);
      expect(res.stderr.indexOf(warningText)).toBeLessThan(
        res.stderr.indexOf(secret),
      );
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 120_000);

  test("schema apply qualifies the verbose warning for a secret-free unredacted plan", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_verbose_no_secret_shadow");
    const target = await cluster.createDb("cli_verbose_no_secret_tgt");
    try {
      const dir = join(
        tmpdir(),
        `pg-delta-next-verbose-no-secret-${Date.now()}`,
      );
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_schema.sql"),
        `CREATE SCHEMA app;\nCREATE TABLE app.items (id integer PRIMARY KEY);\n`,
      );
      writeFileSync(
        join(dir, ".pgdelta-export.json"),
        JSON.stringify({ formatVersion: 1, redactSecrets: false }),
        "utf8",
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--verbose",
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toContain(
        "the verbose output may contain unredacted credentials.",
      );
      expect(res.stderr).not.toContain(
        "the verbose output contains UNREDACTED credentials.",
      );
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 120_000);
});

describe("CLI: schema lint", () => {
  // Pure static analysis — no database, so these run without a container.
  const writeFixture = (
    label: string,
    files: Record<string, string>,
  ): string => {
    const dir = join(tmpdir(), `pg-delta-next-lint-${label}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    for (const [name, sql] of Object.entries(files)) {
      writeFileSync(join(dir, name), sql, "utf8");
    }
    return dir;
  };

  test("a clean schema lints successfully (exit 0)", async () => {
    const dir = writeFixture("clean", {
      "01_table.sql": "CREATE TABLE public.t (id integer PRIMARY KEY);",
      "02_view.sql": "CREATE VIEW public.v AS SELECT id FROM public.t;",
    });
    const result = await runCli(["schema", "lint", "--dir", dir]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("No issues found");
  });

  test("a shadow-load cycle fails the lint (exit 1) with a labeled chain", async () => {
    const dir = writeFixture("cycle", {
      "v1.sql": "CREATE VIEW public.v1 AS SELECT * FROM public.v2;",
      "v2.sql": "CREATE VIEW public.v2 AS SELECT * FROM public.v1;",
    });
    const result = await runCli(["schema", "lint", "--dir", dir]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CYCLE_DETECTED");
    expect(result.stderr).toContain("→");
    expect(result.stderr).toMatch(/error\(s\)/);
  });
});

describe("CLI: schema export --layout grouped", () => {
  test("writes the grouped tree, honoring --group-patterns", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_export_grouped");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.auth_users (id integer PRIMARY KEY);
        CREATE TABLE app.billing_invoices (id integer PRIMARY KEY);
      `);
      const outDir = join(
        tmpdir(),
        `pg-delta-next-export-grouped-${Date.now()}`,
      );
      const result = await runCli([
        "schema",
        "export",
        "--source",
        source.uri,
        "--out-dir",
        outDir,
        "--layout",
        "grouped",
        "--group-patterns",
        '[{"pattern":"^auth_","name":"auth"}]',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("layout: grouped");
      // auth_users consolidated under the auth group; the other table keeps its file
      expect(
        readFileSync(join(outDir, "schemas/app/auth/tables.sql"), "utf8"),
      ).toContain("auth_users");
      expect(
        readFileSync(
          join(outDir, "schemas/app/tables/billing_invoices.sql"),
          "utf8",
        ),
      ).toContain("billing_invoices");
    } finally {
      await source.drop();
    }
  }, 60_000);

  test("rejects a malformed --group-patterns before connecting (exit 2)", async () => {
    const result = await runCli([
      "schema",
      "export",
      "--source",
      "postgresql://localhost/unused",
      "--out-dir",
      join(tmpdir(), `pg-delta-next-export-bad-${Date.now()}`),
      "--layout",
      "grouped",
      "--group-patterns",
      "not json",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--group-patterns");
  });

  test("--format-options pretty-prints the exported SQL", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_export_format");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer PRIMARY KEY, name text NOT NULL);
      `);
      const outDir = join(tmpdir(), `pg-delta-next-export-fmt-${Date.now()}`);
      const result = await runCli([
        "schema",
        "export",
        "--source",
        source.uri,
        "--out-dir",
        outDir,
        "--format-options",
        '{"keywordCase":"lower"}',
      ]);
      expect(result.exitCode).toBe(0);
      const sql = readFileSync(
        join(outDir, "schemas/app/tables/t.sql"),
        "utf8",
      );
      expect(sql).toContain("create table");
      expect(sql).not.toContain("CREATE TABLE");
    } finally {
      await source.drop();
    }
  }, 60_000);

  test("rejects a malformed --format-options before connecting (exit 2)", async () => {
    const result = await runCli([
      "schema",
      "export",
      "--source",
      "postgresql://localhost/unused",
      "--out-dir",
      join(tmpdir(), `pg-delta-next-export-badfmt-${Date.now()}`),
      "--format-options",
      "[1,2,3]",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--format-options");
  });
});

describe("CLI: schema apply debugging", () => {
  test("--dry-run prints the executable script to stdout and applies nothing", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("cli_apply_dryrun_tgt");
    try {
      const dir = join(tmpdir(), `pg-delta-next-dryrun-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_schema.sql"),
        `CREATE SCHEMA app;\nCREATE TABLE app.t (id integer PRIMARY KEY);\n`,
      );

      // no --shadow: co-located shadow on the target's own cluster
      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--dry-run",
      ]);
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      expect(res.stdout).toStartWith(
        "-- pg-delta schema apply --dry-run\n" +
          "-- Execute statements one at a time, in order, on one database session.\n",
      );
      expect(res.stdout).toContain("CREATE TABLE");
      expect(res.stdout).toContain('"app"."t"');
      const beginIndex = res.stdout.indexOf("BEGIN;");
      const searchPathIndex = res.stdout.indexOf(
        "SET LOCAL search_path = pg_catalog;",
      );
      const actionIndex = res.stdout.indexOf("CREATE TABLE");
      const commitIndex = res.stdout.indexOf("COMMIT;", actionIndex);
      expect(beginIndex).toBeGreaterThan(-1);
      expect(searchPathIndex).toBeGreaterThan(beginIndex);
      expect(actionIndex).toBeGreaterThan(searchPathIndex);
      expect(commitIndex).toBeGreaterThan(actionIndex);
      expect(res.stderr).toMatch(
        /Dry run: \d+ action\(s\) planned; nothing applied\./,
      );
      expectDryRunStdoutIsScript(res.stdout);

      // the target must be UNCHANGED — nothing was applied
      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app'`,
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      await target.drop();
    }
  }, 90_000);

  test("--dry-run stdout executes through psql with every transactionality boundary intact", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("cli_apply_dryrun_psql_tgt");
    const dir = mkdtempSync(join(tmpdir(), "pg-delta-next-dryrun-psql-"));
    try {
      await target.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.mood AS ENUM ('sad');
        CREATE TABLE app.items (
          id integer PRIMARY KEY,
          mood app.mood NOT NULL DEFAULT 'sad',
          label text NOT NULL
        );
        INSERT INTO app.items (id, label) VALUES (1, 'kept');
      `);
      writeFileSync(
        join(dir, "01_schema.sql"),
        `
          CREATE SCHEMA app;
          CREATE TYPE app.mood AS ENUM ('sad', 'ok');
          CREATE TABLE app.items (
            id integer PRIMARY KEY,
            mood app.mood NOT NULL DEFAULT 'sad',
            label text NOT NULL
          );
          CREATE INDEX items_label_idx ON app.items (label);
        `,
      );
      const profilePath = join(dir, "concurrent-indexes.json");
      writeFileSync(
        profilePath,
        JSON.stringify({
          id: "cli-dryrun-concurrent-indexes",
          handlers: [],
          policy: {
            id: "cli-dryrun-concurrent-indexes-policy",
            serialize: [
              {
                match: { all: [] },
                params: { concurrentIndexes: true },
              },
            ],
          },
        }),
      );

      const dryRun = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--target",
        target.uri,
        "--profile",
        profilePath,
        "--renames",
        "off",
        "--dry-run",
      ]);
      expect({ code: dryRun.exitCode, stderr: dryRun.stderr }).toMatchObject({
        code: 0,
      });
      expectDryRunStdoutIsScript(dryRun.stdout);
      expect(dryRun.stdout).toContain(`ALTER TYPE "app"."mood" ADD VALUE 'ok'`);
      expect(dryRun.stdout).toContain("CREATE INDEX CONCURRENTLY");

      const psql = Bun.spawn(
        [
          "docker",
          "exec",
          "-i",
          cluster.container.getId(),
          "psql",
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "test",
          "-d",
          target.name,
          "-f",
          "-",
        ],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      );
      await psql.stdin.write(dryRun.stdout);
      await psql.stdin.end();
      const [psqlStdout, psqlStderr, psqlExitCode] = await Promise.all([
        new Response(psql.stdout).text(),
        new Response(psql.stderr).text(),
        psql.exited,
      ]);
      expect({ psqlExitCode, psqlStdout, psqlStderr }).toMatchObject({
        psqlExitCode: 0,
      });

      const state = await target.pool.query<{
        default_expression: string;
        enum_values: string[];
        index_valid: boolean;
        kept_rows: number;
      }>(`
        SELECT
          pg_get_expr(d.adbin, d.adrelid) AS default_expression,
          enum_range(NULL::app.mood)::text[] AS enum_values,
          (SELECT i.indisvalid
             FROM pg_index i
             JOIN pg_class c ON c.oid = i.indexrelid
            WHERE c.oid = 'app.items_label_idx'::regclass) AS index_valid,
          (SELECT count(*)::int FROM app.items WHERE id = 1 AND label = 'kept') AS kept_rows
        FROM pg_attrdef d
        JOIN pg_attribute a
          ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        WHERE d.adrelid = 'app.items'::regclass AND a.attname = 'mood'
      `);
      expect(state.rows[0]).toMatchObject({
        default_expression: "'sad'::app.mood",
        enum_values: ["sad", "ok"],
        index_valid: true,
        kept_rows: 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await target.drop();
    }
  }, 90_000);

  test("--dry-run reports destructive actions without applying them", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("cli_apply_dryrun_drop_tgt");
    try {
      await target.pool.query(
        `CREATE SCHEMA app; CREATE TABLE app.obsolete (id integer PRIMARY KEY);`,
      );
      const dir = join(tmpdir(), `pg-delta-next-dryrun-drop-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "01_schema.sql"), `CREATE SCHEMA app;\n`);
      const planPath = join(dir, "plan.json");

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--dry-run",
        "--out-plan",
        planPath,
      ]);

      expect({
        code: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
      }).toMatchObject({ code: 0 });
      expect(res.stdout).toContain("DROP TABLE");
      expect(res.stdout).toContain('"app"."obsolete"');
      expectDryRunStdoutIsScript(res.stdout);
      const destructiveWarning = res.stderr.match(
        /WARNING: plan contains (\d+) destructive action\(s\)\./,
      );
      expect(destructiveWarning).not.toBeNull();
      const warningCount = Number(destructiveWarning?.[1]);
      const parsed = parsePlan(readFileSync(planPath, "utf8"));
      expect(warningCount).toBeGreaterThan(0);
      expect(warningCount).toBe(parsed.safetyReport.destructiveActions);
      const { rows } = await target.pool.query<{ exists: boolean }>(
        `SELECT to_regclass('app.obsolete') IS NOT NULL AS exists`,
      );
      expect(rows[0]?.exists).toBe(true);
    } finally {
      await target.drop();
    }
  }, 90_000);

  test("--dry-run --out-plan writes a plan artifact that parses with actions", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("cli_apply_dryrun_outplan_tgt");
    try {
      const dir = join(tmpdir(), `pg-delta-next-dryrun-outplan-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_schema.sql"),
        `CREATE SCHEMA app;\nCREATE TABLE app.t (id integer PRIMARY KEY);\n`,
      );
      const planPath = join(dir, "plan.json");

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--dry-run",
        "--out-plan",
        planPath,
      ]);
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      expect(res.stderr).toContain(`Plan artifact written to ${planPath}`);
      expectDryRunStdoutIsScript(res.stdout);

      const parsed = parsePlan(readFileSync(planPath, "utf8"));
      expect(parsed.actions.length).toBeGreaterThan(0);
      // the artifact records the redaction mode it was fingerprinted under, so
      // a later `pgdelta apply --plan` re-extracts in the SAME mode instead of
      // defaulting to redacted and tripping the fingerprint gate.
      expect(parsed.redactSecrets).toBe(true);

      // still nothing applied
      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app'`,
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      await target.drop();
    }
  }, 90_000);

  test("--verbose logs per-statement progress to stderr during a real apply", async () => {
    const cluster = await sharedCluster();
    const shadow = await cluster.createDb("cli_apply_verbose_shadow");
    const target = await cluster.createDb("cli_apply_verbose_tgt");
    try {
      const dir = join(tmpdir(), `pg-delta-next-verbose-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_schema.sql"),
        `CREATE SCHEMA app;\nCREATE TABLE app.t (id integer PRIMARY KEY);\n`,
      );

      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--shadow",
        shadow.uri,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--verbose",
      ]);
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      expect(res.stderr).toContain("[1/");
      expect(res.stderr).toContain("ok (");
      // --verbose is a COMPLETE record of the wire, not just plan actions: the
      // applied statements are planner-rendered atomic DDL, so the trace must
      // also show the transaction framing actually sent (BEGIN/COMMIT) — with
      // the documented "  ; " control prefix that keeps those lines visually
      // distinct from `[i/total] <action sql>` lines.
      expect(res.stderr).toContain("  ; BEGIN");
      expect(res.stderr).toContain("  ; COMMIT");
      expect(res.stdout).toBe("");

      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app'`,
      );
      expect(rows[0]?.n).toBe(1);
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 90_000);

  test("--dry-run warns about unredacted credentials when the export MANIFEST recorded the unredacted mode (no flag re-passed)", async () => {
    // The effective redaction mode is `manifest?.redactSecrets ?? !flag`: a
    // dir exported with --unsafe-show-secrets stamps redactSecrets:false in
    // its manifest and is re-applied unredacted WITHOUT the operator
    // re-passing the flag. The dry-run script (and --out-plan artifact) then
    // carry real credentials, so the warning must key on the effective mode,
    // not on the flag.
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_apply_dryrun_unred_src");
    const target = await cluster.createDb("cli_apply_dryrun_unred_tgt");
    try {
      const secret = "cli-dryrun-secret-xyz";
      await source.pool.query(`
        CREATE FOREIGN DATA WRAPPER cli_dryrun_fdw;
        CREATE SERVER cli_dryrun_srv FOREIGN DATA WRAPPER cli_dryrun_fdw
          OPTIONS (host 'h.example.com', password '${secret}');
      `);
      const dir = join(tmpdir(), `pg-delta-next-dryrun-unred-${Date.now()}`);
      const exported = await runCli([
        "schema",
        "export",
        "--source",
        source.uri,
        "--out-dir",
        dir,
        "--unsafe-show-secrets",
      ]);
      expect(exported.exitCode).toBe(0);

      const planPath = join(dir, "plan.json");
      // NOTE: no --unsafe-show-secrets here — the manifest supplies the mode.
      const res = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--dry-run",
        "--out-plan",
        planPath,
      ]);
      expect({ code: res.exitCode, stderr: res.stderr }).toMatchObject({
        code: 0,
      });
      // both unredacted output channels warn: the plan artifact and the script
      const warnings = res.stderr
        .split("\n")
        .filter((l) => l.includes("UNREDACTED"));
      expect(warnings.length).toBe(2);
      expectDryRunStdoutIsScript(res.stdout);
      expect(res.stdout).toContain(secret);
      expect(res.stdout).not.toContain("__OPTION_PASSWORD__");
      expect(res.stderr).not.toContain(secret);

      // and the artifact STAMPS the unredacted mode: its fingerprint was taken
      // from unredacted extracts, so `pgdelta apply --plan` must re-extract
      // unredacted too — an absent field reads as redacted and the gate would
      // spuriously reject an unchanged target.
      const serializedPlan = readFileSync(planPath, "utf8");
      expect(serializedPlan).toContain(secret);
      expect(serializedPlan).not.toContain("__OPTION_PASSWORD__");
      const parsed = parsePlan(serializedPlan);
      expect(parsed.redactSecrets).toBe(false);
    } finally {
      await Promise.all([source.drop(), target.drop()]);
    }
  }, 90_000);
});
