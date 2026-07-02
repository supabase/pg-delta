/**
 * Maintainer workflow: regenerate the Supabase baseline fixture replayed by
 * integration tests that need a realistic post-`supabase start` target.
 *
 * For the pinned Supabase image (tests/containers.ts `SUPABASE_IMAGE`) we:
 *   1. stop any running local Supabase stacks (free the default ports)
 *   2. boot a BARE `supabase/postgres:<tag>` container (the "before" — just the
 *      image, before the service stack bootstraps its own schemas)
 *   3. `supabase start` a temp project pinned to the SAME tag (the "after" —
 *      every service ran its init/migrations)
 *   4. diff bare -> full with pg-delta-next ITSELF (raw plan: cluster-global
 *      roles + memberships + default privileges + auth/storage/realtime schemas
 *      all captured), render it to SQL, and write
 *      tests/fixtures/supabase-base-init/<major>.sql
 *   5. ZERO-DIFF GATE: replay the fixture into a FRESH bare container, re-extract,
 *      and require a subsequent bare->full plan to be empty. A non-empty plan
 *      means the fixture is incomplete and the script fails.
 *
 * Dogfooding the diff (rather than a pg_dump delta) gets redaction and every
 * ACL/role/default-privilege edge case the engine already handles for free.
 *
 * USAGE
 *   cd packages/pg-delta-next
 *   DOCKER_HOST=unix:///.../docker.sock bun run sync-base-images
 *
 * NOTE: not for CI — it needs Docker + the Supabase CLI and produces a committed
 * artifact. Regenerate locally when SUPABASE_IMAGE changes and commit the result.
 */
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pg from "pg";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { renderPlanSql } from "../src/plan/render-sql.ts";
import { SUPABASE_BARE_MAJOR, SUPABASE_IMAGE } from "../tests/containers.ts";
import { supabaseBaseInitFixturePath } from "../tests/supabase-base-init.ts";

const SUPABASE_BIN = process.env["SUPABASE_BIN"] ?? "supabase";
const SUPABASE_TAG = SUPABASE_IMAGE.split(":")[1] ?? "17.6.1.135";
// `supabase start` exposes the local stack DB on 54322 by default; we free that
// port (step 1) before starting the temp project. Connect as `supabase_admin`
// on both sides — pg-delta-next extract is current_user-sensitive for owner
// edges / grants / default privileges, so the diff must be symmetric.
const FULL_DB_URL = `postgres://supabase_admin:postgres@127.0.0.1:54322/postgres`;
const pkgRoot = join(import.meta.dir, "..");

/** Patch only `[db].major_version` in a Supabase config.toml, preserving the
 *  rest (the CLI owns the surrounding TOML). Ported from the old package. */
function ensureSupabaseDbMajorVersion(
  configToml: string,
  majorVersion: number,
): string {
  const newline = configToml.includes("\r\n") ? "\r\n" : "\n";
  const lines = configToml.split(/\r?\n/);
  const dbSectionIndex = lines.findIndex((line) => line.trim() === "[db]");
  if (dbSectionIndex === -1) {
    throw new Error("Supabase config is missing a [db] section");
  }
  let nextSectionIndex = lines.findIndex(
    (line, index) =>
      index > dbSectionIndex &&
      line.trim().startsWith("[") &&
      line.trim().endsWith("]"),
  );
  if (nextSectionIndex === -1) nextSectionIndex = lines.length;
  const majorVersionLineIndex = lines.findIndex(
    (line, index) =>
      index > dbSectionIndex &&
      index < nextSectionIndex &&
      line.trim().startsWith("major_version"),
  );
  if (majorVersionLineIndex === -1) {
    lines.splice(dbSectionIndex + 1, 0, `major_version = ${majorVersion}`);
  } else {
    lines[majorVersionLineIndex] = `major_version = ${majorVersion}`;
  }
  return lines.join(newline);
}

async function runCommand(options: {
  cmd: string[];
  cwd: string;
  allowedExitCodes?: number[];
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: options.cmd,
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const allowed = options.allowedExitCodes ?? [0];
  if (!allowed.includes(exitCode)) {
    throw new Error(
      `Command failed (${exitCode}): ${options.cmd.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return { stdout, stderr, exitCode };
}

async function waitForPool(
  pool: pg.Pool,
  retries = 40,
  delayMs = 2_000,
): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch (error) {
      if (attempt === retries - 1) {
        throw new Error(
          `Pool not ready after ${retries} attempts: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await Bun.sleep(delayMs);
    }
  }
}

function managedPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 20_000,
  });
  // 57P01 (admin shutdown) / 53100 (disk full) are expected during the many
  // ephemeral container teardowns; don't let them crash the process.
  pool.on("error", (err: Error & { code?: string }) => {
    if (err.code === "57P01" || err.code === "53100") return;
    console.error("Pool error:", err);
  });
  return pool;
}

async function stopAllSupabaseStacks(): Promise<void> {
  console.log("[sync] Stopping any running Supabase stacks (stop --all)...");
  await runCommand({
    cmd: [SUPABASE_BIN, "stop", "--all", "--no-backup"],
    cwd: pkgRoot,
    // `stop --all` exits non-zero when nothing is running on some CLI versions.
    allowedExitCodes: [0, 1],
  });
}

async function prepareSupabaseProject(
  workdir: string,
  major: number,
): Promise<void> {
  await runCommand({
    cmd: [SUPABASE_BIN, "init", "--yes", "--workdir", workdir],
    cwd: pkgRoot,
  });
  const supabaseDir = join(workdir, "supabase");
  const configPath = join(supabaseDir, "config.toml");
  const configToml = await readFile(configPath, "utf-8");
  await writeFile(
    configPath,
    ensureSupabaseDbMajorVersion(configToml, major),
    "utf-8",
  );
  // Pin the EXACT image tag (not just the major) the way the CLI expects, so the
  // full stack boots the same build as the bare container we diff against.
  await mkdir(join(supabaseDir, ".temp"), { recursive: true });
  await writeFile(
    join(supabaseDir, ".temp", "postgres-version"),
    `${SUPABASE_TAG}\n`,
    "utf-8",
  );
}

async function startBareContainer(): Promise<{
  uri: string;
  stop: () => Promise<void>;
}> {
  console.log(`[sync] Booting bare ${SUPABASE_IMAGE}...`);
  const container: StartedTestContainer = await new GenericContainer(
    SUPABASE_IMAGE,
  )
    .withEnvironment({
      POSTGRES_USER: "supabase_admin",
      POSTGRES_PASSWORD: "postgres",
      POSTGRES_DB: "postgres",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(180_000)
    .withTmpFs({ "/var/lib/postgresql/data": "rw,noexec,nosuid,size=1024m" })
    .start();
  const uri = `postgres://supabase_admin:postgres@${container.getHost()}:${container.getMappedPort(5432)}/postgres`;
  return { uri, stop: () => container.stop().then(() => undefined) };
}

/** Fail loudly if `supabase start` booted a different image than the bare
 *  container — the fixture would otherwise bake in version-skewed schema. */
async function assertFullStackTag(): Promise<void> {
  const { stdout } = await runCommand({
    cmd: [
      "docker",
      "ps",
      "--filter",
      "name=supabase_db_",
      "--format",
      "{{.Image}}",
    ],
    cwd: pkgRoot,
  });
  const image = stdout.trim().split("\n")[0] ?? "";
  if (!image.endsWith(`:${SUPABASE_TAG}`)) {
    throw new Error(
      `Full stack DB image is "${image}", expected tag "${SUPABASE_TAG}". ` +
        `The .temp/postgres-version pin did not take (Supabase CLI ${SUPABASE_TAG} mismatch); ` +
        `the fixture would be version-skewed. Aborting.`,
    );
  }
  console.log(`[sync] Full stack DB image confirmed: ${image}`);
}

/** Apply each action on its own (autocommit, continue-on-error) to surface
 *  EVERY action that fails to apply, not just the first. `check_function_bodies`
 *  is disabled once on the session so forward-referencing bodies elaborate, the
 *  same as the batch replay. Cascade victims (an action failing because an
 *  earlier one did) are included — the list sizes the convergence gaps. */
async function enumerateReplayFailures(
  pool: pg.Pool,
  actions: ReadonlyArray<{ sql: string }>,
): Promise<Array<{ i: number; sql: string; message: string }>> {
  const failures: Array<{ i: number; sql: string; message: string }> = [];
  const client = await pool.connect();
  try {
    await client.query("SET check_function_bodies = off");
    for (let i = 0; i < actions.length; i++) {
      const sql = actions[i]!.sql;
      try {
        await client.query(sql);
      } catch (e) {
        failures.push({
          i,
          sql: (sql.split("\n")[0] ?? sql).slice(0, 160),
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    client.release();
  }
  return failures;
}

async function generateFixture(major: number): Promise<void> {
  const workdir = await mkdtemp(
    join(tmpdir(), `pgdelta-supabase-sync-pg${major}-`),
  );
  const fixturePath = supabaseBaseInitFixturePath(major);

  let fullPool: pg.Pool | undefined;
  let barePool: pg.Pool | undefined;
  let validatedPool: pg.Pool | undefined;
  let bare: Awaited<ReturnType<typeof startBareContainer>> | undefined;
  let validated: Awaited<ReturnType<typeof startBareContainer>> | undefined;

  try {
    // ── Full stack (after) ─────────────────────────────────────────────────
    await prepareSupabaseProject(workdir, major);
    console.log(`[sync] supabase start (pg${major}, tag ${SUPABASE_TAG})...`);
    await runCommand({
      cmd: [SUPABASE_BIN, "start", "--workdir", workdir],
      cwd: pkgRoot,
    });
    await assertFullStackTag();
    fullPool = managedPool(FULL_DB_URL);
    await waitForPool(fullPool);

    // ── Bare image (before) ────────────────────────────────────────────────
    bare = await startBareContainer();
    barePool = managedPool(bare.uri);
    await waitForPool(barePool);

    // ── Diff bare -> full, render, persist ──────────────────────────────────
    console.log(`[sync] Extracting bare + full and planning delta...`);
    const [base, full] = await Promise.all([
      extract(barePool, { redactSecrets: true }),
      extract(fullPool, { redactSecrets: true }),
    ]);
    const thePlan = plan(base.factBase, full.factBase, {
      renames: "off",
      compact: true,
    });
    console.log(`[sync] Delta: ${thePlan.actions.length} action(s).`);
    const body = renderPlanSql(thePlan);
    const header =
      `-- Supabase baseline: delta from bare ${SUPABASE_IMAGE} to \`supabase start\`.\n` +
      `-- Generated by scripts/sync-supabase-base-images.ts — DO NOT EDIT BY HAND.\n` +
      `-- Regenerate with: bun run sync-base-images\n\n`;
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, header + body, "utf-8");
    console.log(`[sync] Wrote ${fixturePath}`);

    // ── Zero-diff gate ──────────────────────────────────────────────────────
    console.log(
      `[sync] Validating fixture (replay -> re-diff must be empty)...`,
    );
    validated = await startBareContainer();
    validatedPool = managedPool(validated.uri);
    await waitForPool(validatedPool);
    // Replay exactly as `applySupabaseBaseInit` does: one multi-statement batch
    // on a single connection (implicit transaction). On failure the whole batch
    // rolls back, so the DB is clean again — re-apply action-by-action to
    // enumerate EVERY failing action (not just the first), which is what sizes
    // the remaining convergence gaps.
    if (body.trim() !== "") {
      try {
        await validatedPool.query(body);
      } catch (batchErr) {
        const failures = await enumerateReplayFailures(
          validatedPool,
          thePlan.actions,
        );
        const detail = failures
          .map((f) => `  [action ${f.i}] ${f.message}\n       ${f.sql}`)
          .join("\n");
        throw new Error(
          `Fixture replay FAILED — ${failures.length} action(s) do not apply ` +
            `(first batch error: ${batchErr instanceof Error ? batchErr.message : String(batchErr)}).\n${detail}`,
        );
      }
    }
    const replayed = await extract(validatedPool, { redactSecrets: true });
    const gate = plan(replayed.factBase, full.factBase, {
      renames: "off",
      compact: true,
    });
    // PGDELTA_SYNC_DEBUG_DIR=<dir>: dump both gate-side snapshots for offline
    // analysis of residuals (avoids re-running `supabase start` per hypothesis).
    const debugDir = process.env["PGDELTA_SYNC_DEBUG_DIR"];
    if (debugDir) {
      await mkdir(debugDir, { recursive: true });
      const { serializeSnapshot } = await import("../src/core/snapshot.ts");
      await writeFile(
        join(debugDir, `replayed-${major}.json`),
        serializeSnapshot(replayed.factBase, { pgVersion: replayed.pgVersion }),
        "utf-8",
      );
      await writeFile(
        join(debugDir, `full-${major}.json`),
        serializeSnapshot(full.factBase, { pgVersion: full.pgVersion }),
        "utf-8",
      );
      console.log(`[sync] Debug snapshots written to ${debugDir}`);
    }
    if (gate.actions.length !== 0) {
      const residual = gate.actions.map((a) => `  ${a.sql};`).join("\n");
      throw new Error(
        `Zero-diff gate FAILED: ${gate.actions.length} residual action(s) after replay.\n${residual}`,
      );
    }
    console.log(`[sync] Zero-diff gate passed for pg${major}. ✅`);
  } finally {
    await Promise.all(
      [fullPool, barePool, validatedPool]
        .filter((p): p is pg.Pool => p !== undefined)
        .map((p) => p.end().catch(() => {})),
    );
    await Promise.all(
      [bare, validated]
        .filter(
          (c): c is { uri: string; stop: () => Promise<void> } =>
            c !== undefined,
        )
        .map((c) => c.stop().catch(() => {})),
    );
    await runCommand({
      cmd: [SUPABASE_BIN, "stop", "--workdir", workdir, "--no-backup"],
      cwd: pkgRoot,
      allowedExitCodes: [0, 1],
    }).catch((e) =>
      console.warn(`[sync] stop failed: ${e instanceof Error ? e.message : e}`),
    );
    await rm(workdir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await access(pkgRoot);
  await stopAllSupabaseStacks();
  await generateFixture(SUPABASE_BARE_MAJOR);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
