/**
 * The engine suite (stage 0 + stage 3): every corpus scenario through the
 * proof loop, in BOTH directions. Cluster-level scenarios (meta.isolatedCluster)
 * place state A and state B on separate clusters with role cleanup.
 * EXPECTED_RED pins scenarios whose engine support hasn't landed: a pinned
 * test must fail; a pinned test that passes fails the suite.
 */
import { writeSync } from "node:fs";
import os from "node:os";
import { describe, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { encodeId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { probeApplierCapability } from "../src/policy/capability.ts";
import { rel } from "../src/plan/render.ts";
import { provePlan } from "../src/proof/prove.ts";
import { enforceSeedCoverage, runPinnedDirection } from "./seed-coverage.ts";
import { loadCorpus, type Scenario } from "./corpus.ts";
import { mustRunSerially } from "./corpus-scheduling.ts";
import {
  isolatedClusterPair,
  sharedCluster,
  type Cluster,
} from "./containers.ts";
import { EXPECTED_RED } from "./expected-red.ts";

const COMPACT_MODES = [true, false] as const;
type ModeRunner = (key: string, run: () => Promise<void>) => Promise<void>;

function compactLabel(compact: boolean): string {
  return compact ? "compact" : "uncompact";
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withModeContext(
  key: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) {
      if (!error.message.includes(`[${key}]`)) {
        error.message = `[${key}] ${error.message}`;
      }
      throw error;
    }
    throw new Error(`[${key}] ${String(error)}`);
  }
}

async function runCompactModes(
  run: (compact: boolean) => Promise<void>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const compact of COMPACT_MODES) {
    try {
      await run(compact);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, failures.map(failureMessage).join("\n"));
  }
}

async function proveOn(
  name: string,
  scenarioName: string,
  direction: "forward" | "reverse",
  compact: boolean,
  clusterA: Cluster,
  clusterB: Cluster,
  fromSql: string,
  toSql: string,
  seed: string | undefined,
): Promise<void> {
  const source = await clusterA.createDb("src");
  const desired = await clusterB.createDb("dst");
  try {
    await source.pool.query(fromSql);
    await desired.pool.query(toSql);
    if (seed) await source.pool.query(seed);

    const [sourceState, desiredState] = [
      await extract(source.pool),
      await extract(desired.pool),
    ];
    // probe the applier (connection user `test`, a superuser here) so the corpus
    // exercises the capability-gated compaction (Rule 2 owner-ALTER elision).
    // Superuser → canSetOwner never fail-fasts, so this only adds the cosmetic
    // elision; the proof still validates convergence, not SQL bytes.
    const capability = await probeApplierCapability(source.pool);
    const thePlan = plan(sourceState.factBase, desiredState.factBase, {
      capability,
      compact,
    });

    const clone = await source.clone();
    // the original source DB would block cluster-wide DROP ROLE actions
    // (the role still owns its objects there); the clone is the proof target
    await source.drop();
    try {
      // TEMPLATE cloning skips shared-catalog state (subscriptions): presync
      // the clone to the source's fact base before proving the real plan
      const cloneState = await extract(clone.pool);
      if (cloneState.factBase.rootHash !== sourceState.factBase.rootHash) {
        const presync = plan(cloneState.factBase, sourceState.factBase);
        const presyncReport = await apply(presync, clone.pool, {
          fingerprintGate: false,
        });
        if (presyncReport.status !== "applied") {
          throw new Error(
            `[${name}] clone presync failed: ${presyncReport.error?.message}`,
          );
        }
      }
      const verdict = await provePlan(
        thePlan,
        clone.pool,
        desiredState.factBase,
        {
          // corpus-only flip (P3): the library default stays opt-in. Seeding every
          // empty kept table gives the data-preservation proof teeth even for
          // scenarios that ship no seed.sql; the coverage contract below then
          // requires every non-seed to be an EXPECTED class-23 skip.
          autoSeed: true,
        },
      );
      enforceSeedCoverage(scenarioName, direction, name, verdict);
      if (!verdict.ok) {
        const planText = thePlan.actions
          .map((a, i) => `  ${i}: ${a.sql}`)
          .join("\n");
        if (verdict.applyError) {
          throw new Error(
            `[${name}] apply failed at action ${verdict.applyError.actionIndex}: ${verdict.applyError.message}\n${planText}`,
          );
        }
        const drift = verdict.driftDeltas
          .map((d) =>
            d.verb === "set"
              ? `  set ${encodeId(d.id)}.${d.attr}: ${JSON.stringify(d.from)} -> ${JSON.stringify(d.to)}`
              : d.verb === "add" || d.verb === "remove"
                ? `  ${d.verb} ${encodeId(d.fact.id)}`
                : `  ${d.verb} ${encodeId(d.edge.from)} -> ${encodeId(d.edge.to)}`,
          )
          .join("\n");
        const data = verdict.dataViolations
          .map(
            (v) =>
              `  ${rel(v.table.schema, v.table.name)}: ${v.before} -> ${v.after} rows`,
          )
          .join("\n");
        const rewrites = verdict.rewriteViolations
          .map(
            (v) =>
              `  ${rel(v.table.schema, v.table.name)}: relfilenode changed, no rewriteRisk declared`,
          )
          .join("\n");
        throw new Error(
          `[${name}] proof failed\ndrift:\n${drift}\ndata:\n${data}\nrewrites:\n${rewrites}\nplan:\n${planText}`,
        );
      }
    } finally {
      await clone.drop();
    }
  } finally {
    await Promise.all([source.drop(), desired.drop()]);
  }
}

async function runDirection(
  scenario: Scenario,
  direction: "forward" | "reverse",
  modeRunner: ModeRunner = async (_key, run) => run(),
): Promise<void> {
  const [fromSql, toSql, seed] =
    direction === "forward"
      ? [scenario.a, scenario.b, scenario.seed]
      : [scenario.b, scenario.a, scenario.seedB];
  const label = `${scenario.name}:${direction}`;

  const proveMode = async (
    compact: boolean,
    clusterA: Cluster,
    clusterB: Cluster,
    cleanup: () => Promise<unknown> = async () => {},
  ): Promise<void> => {
    const key = `${label} [${compactLabel(compact)}]`;
    let modeFailed = false;
    let modeError: unknown;
    try {
      await modeRunner(key, () =>
        withModeContext(key, () =>
          proveOn(
            key,
            scenario.name,
            direction,
            compact,
            clusterA,
            clusterB,
            fromSql,
            toSql,
            seed,
          ),
        ),
      );
    } catch (error) {
      modeFailed = true;
      modeError = error;
    }

    // Cleanup is intentionally outside modeRunner: EXPECTED_RED classifies
    // planner/proof failures only and must never swallow a broken teardown.
    let cleanupFailed = false;
    let cleanupError: unknown;
    try {
      await withModeContext(key, async () => {
        await cleanup();
      });
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
    }

    if (modeFailed && cleanupFailed) {
      // Preserve the mode error's concrete type: SeedCoverageError must remain
      // distinguishable so EXPECTED_RED can never swallow it.
      if (modeError instanceof Error) {
        modeError.message += `\ncleanup also failed: ${failureMessage(cleanupError)}`;
        throw modeError;
      }
      throw new AggregateError(
        [modeError, cleanupError],
        `proof failed: ${failureMessage(modeError)}\ncleanup also failed: ${failureMessage(cleanupError)}`,
      );
    }
    if (modeFailed) throw modeError;
    if (cleanupFailed) throw cleanupError;
  };

  if (scenario.meta.isolatedCluster) {
    const [clusterA, clusterB] = await isolatedClusterPair();
    if (scenario.meta.minVersion !== undefined) {
      if ((await clusterA.pgMajor()) < scenario.meta.minVersion) return;
    }
    const [baseA, baseB] = await Promise.all([
      clusterA.listRoles(),
      clusterB.listRoles(),
    ]);
    await runCompactModes((compact) =>
      proveMode(compact, clusterA, clusterB, async () => {
        // proveOn drops every scenario database before returning. Only then is
        // it safe to reset cluster-global roles for the next mode's replay.
        await Promise.all([
          clusterA.dropRolesExcept(baseA, { strict: true }),
          clusterB.dropRolesExcept(baseB, { strict: true }),
        ]);
      }),
    );
    return;
  }

  const cluster = await sharedCluster();
  if (scenario.meta.minVersion !== undefined) {
    if ((await cluster.pgMajor()) < scenario.meta.minVersion) return;
  }

  if (mustRunSerially(scenario)) {
    const baselineRoles = await cluster.listRoles();
    await runCompactModes((compact) =>
      proveMode(compact, cluster, cluster, async () => {
        // Database teardown lives inside proveOn and therefore completes before
        // role cleanup. This ordering avoids DROP ROLE ownership/grant errors.
        await cluster.dropRolesExcept(baselineRoles, { strict: true });
      }),
    );
    return;
  }

  await runCompactModes((compact) => proveMode(compact, cluster, cluster));
}

async function runPinnedOrProve(
  scenario: Scenario,
  direction: "forward" | "reverse",
): Promise<void> {
  // Pin granularity: bare `<name>` pins BOTH directions; `<name>:forward` /
  // `<name>:reverse` pin only that direction (so the other may legitimately pass).
  const key =
    direction === "forward"
      ? `${scenario.name}:forward`
      : `${scenario.name}:reverse`;
  const pin = EXPECTED_RED.get(key) ?? EXPECTED_RED.get(scenario.name);
  let pinned = pin !== undefined;
  if (pinned && pin?.minMajor !== undefined) {
    // Version-gated pin: on older majors the server behavior that makes the
    // scenario red doesn't exist, so it runs normally and must pass.
    const cluster = await sharedCluster();
    if ((await cluster.pgMajor()) < pin.minMajor) pinned = false;
  }
  const modeRunner = pinned
    ? (modeKey: string, run: () => Promise<void>) =>
        // runPinnedDirection owns the pinned semantics (incl. the seed-coverage
        // rethrow), so the guard is bound by seed-coverage.test.ts. Applying it
        // per mode ensures both artifacts run and each stale pin is detected.
        runPinnedDirection(modeKey, run)
    : undefined;
  await runDirection(scenario, direction, modeRunner);
}

// Live progress (opt-in via PGDELTA_NEXT_PROGRESS=1). `bun test` buffers its
// own reporter when stdout is a pipe (background / CI), so a piped corpus run
// shows nothing until it finishes. A raw write to fd 2 bypasses that capture and
// streams a `[done/total]` line per scenario as it completes. Off by default so
// an interactive TTY run keeps bun's native reporter clean.
const CORPUS = loadCorpus();
const CORPUS_TOTAL = CORPUS.length * 2;
const SHOW_PROGRESS = /^(1|true)$/i.test(
  process.env["PGDELTA_NEXT_PROGRESS"] ?? "",
);
let corpusDone = 0;
function corpusProgress(label: string, ok: boolean): void {
  corpusDone++;
  if (!SHOW_PROGRESS) return;
  const pct = Math.round((corpusDone / CORPUS_TOTAL) * 100);
  const img = process.env["PGDELTA_TEST_IMAGE"] ?? "default";
  writeSync(
    2,
    `corpus ${img} [${corpusDone}/${CORPUS_TOTAL} ${pct}%] ${ok ? "PASS" : "FAIL"} ${label}\n`,
  );
}

// Bounded-concurrency fast path (opt-in via PGDELTA_NEXT_CONCURRENCY=K). Default
// (unset / 1) keeps the per-case serial tests below — unchanged for CI, clean
// reporting, and EXPECTED_RED granularity. With K>1, a single driver runs the
// SHARED-cluster cases through a pool of K (they use independent databases on
// one cluster, so they're safe to run concurrently — `max_connections=300` is
// provisioned for exactly this), while `isolatedCluster` cases run SERIALLY
// (they mutate cluster-level role state and would corrupt each other's role
// snapshots). K is capped to CPU cores so the host / PostgreSQL container is not
// oversubscribed — the failure mode that inflates wall-time. The corpus is
// I/O-bound on Postgres, so this trades the runner's serial dispatch for the
// container's real concurrency ceiling.
const CONCURRENCY = Math.min(
  Math.max(
    1,
    Math.floor(Number(process.env["PGDELTA_NEXT_CONCURRENCY"] ?? "1")) || 1,
  ),
  os.availableParallelism?.() ?? os.cpus().length,
);

interface Case {
  scenario: Scenario;
  direction: "forward" | "reverse";
  label: string;
}

const ALL_CASES: Case[] = CORPUS.flatMap((scenario) => [
  { scenario, direction: "forward", label: `${scenario.name} (a->b)` },
  { scenario, direction: "reverse", label: `${scenario.name} (b->a)` },
]);

// Roles, role memberships, and other cluster-level objects are GLOBAL on the
// shared cluster — they are NOT confined to a scenario's per-case databases.
// Scenarios that touch them (CREATE/DROP/ALTER ROLE/USER/GROUP) reuse role
// names across cases and rely on serial execution; running two concurrently
// collides ("role already exists", "duplicate key pg_authid", "cannot be
// dropped"). Such cases (plus the explicitly cluster-level isolatedCluster ones)
// run SERIALLY; only genuinely DB-local scenarios go in the concurrent pool.
if (CONCURRENCY > 1) {
  describe("engine: corpus proof loop (concurrent)", () => {
    test(`all ${CORPUS_TOTAL} cases (concurrency=${CONCURRENCY})`, async () => {
      const failures: string[] = [];
      const runOne = async (c: Case): Promise<void> => {
        let ok = false;
        try {
          await runPinnedOrProve(c.scenario, c.direction);
          ok = true;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          failures.push(c.label);
          // full detail to stderr so a concurrent failure isn't lost in the
          // single driver test's aggregated output
          writeSync(2, `\nFAIL ${c.label}: ${msg}\n`);
        } finally {
          corpusProgress(c.label, ok);
        }
      };

      // DB-local cases: bounded pool of K workers pulling from a shared
      // cursor (single-threaded JS → `index++` needs no lock)
      const concurrent = ALL_CASES.filter((c) => !mustRunSerially(c.scenario));
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, concurrent.length) }, () =>
          (async () => {
            for (let i = cursor++; i < concurrent.length; i = cursor++) {
              await runOne(concurrent[i] as Case);
            }
          })(),
        ),
      );

      // cluster-level cases (roles/memberships, isolatedCluster): serial
      for (const c of ALL_CASES.filter((c) => mustRunSerially(c.scenario))) {
        await runOne(c);
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${CORPUS_TOTAL} corpus cases failed (details above):\n` +
            failures.map((l) => `  ${l}`).join("\n"),
        );
      }
    }, 1_800_000);
  });
} else {
  describe("engine: corpus proof loop", () => {
    for (const c of ALL_CASES) {
      test(
        c.direction === "forward"
          ? `${c.scenario.name} (a -> b)`
          : `${c.scenario.name} (b -> a, teardown direction)`,
        async () => {
          let ok = false;
          try {
            await runPinnedOrProve(c.scenario, c.direction);
            ok = true;
          } finally {
            corpusProgress(c.label, ok);
          }
        },
        360_000,
      );
    }
  });
}
