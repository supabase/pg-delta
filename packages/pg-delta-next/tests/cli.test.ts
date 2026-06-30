/**
 * CLI integration tests (stage-9 deliverable 5/7/8).
 * Spawns the CLI with Bun.spawn and asserts observable behaviour.
 *
 * All tests use the sharedCluster() fixture from containers.ts.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadSnapshot } from "../src/frontends/snapshot-file.ts";
import { sharedCluster } from "./containers.ts";

const PKG_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CLI = join(PKG_DIR, "src/cli/main.ts");

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

const SCHEMA_SQL = `
  CREATE SCHEMA clitest;
  CREATE TABLE clitest.items (
    id serial PRIMARY KEY,
    name text NOT NULL
  );
  CREATE INDEX items_name_idx ON clitest.items (name);
`;

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
});

// REVIEW_HANDOFF.md P1: schema export/apply must be profile-aware like `plan`,
// instead of always using the raw view — otherwise SQL-file workflows diverge
// from the profile-aware DB-to-DB path. These prove the `--profile` /
// `--restrict-to-applier` flags exist and thread through extract/plan/apply.
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
