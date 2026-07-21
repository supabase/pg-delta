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
import { enforceSeedCoverage, SeedCoverageError } from "./seed-coverage.ts";
import { loadCorpus, type Scenario } from "./corpus.ts";
import {
  isolatedClusterPair,
  sharedCluster,
  type Cluster,
} from "./containers.ts";
import { EXPECTED_RED } from "./expected-red.ts";

async function proveOn(
  name: string,
  scenarioName: string,
  direction: "forward" | "reverse",
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
): Promise<void> {
  const [fromSql, toSql, seed] =
    direction === "forward"
      ? [scenario.a, scenario.b, scenario.seed]
      : [scenario.b, scenario.a, undefined];
  const label =
    direction === "forward" ? scenario.name : `${scenario.name}:reverse`;

  if (scenario.meta.isolatedCluster) {
    const [clusterA, clusterB] = await isolatedClusterPair();
    if (scenario.meta.minVersion !== undefined) {
      if ((await clusterA.pgMajor()) < scenario.meta.minVersion) return;
    }
    const [baseA, baseB] = await Promise.all([
      clusterA.listRoles(),
      clusterB.listRoles(),
    ]);
    try {
      await proveOn(
        label,
        scenario.name,
        direction,
        clusterA,
        clusterB,
        fromSql,
        toSql,
        seed,
      );
    } finally {
      await Promise.all([
        clusterA.dropRolesExcept(baseA),
        clusterB.dropRolesExcept(baseB),
      ]);
    }
    return;
  }

  const cluster = await sharedCluster();
  if (scenario.meta.minVersion !== undefined) {
    if ((await cluster.pgMajor()) < scenario.meta.minVersion) return;
  }
  await proveOn(
    label,
    scenario.name,
    direction,
    cluster,
    cluster,
    fromSql,
    toSql,
    seed,
  );
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
  if (!pinned) {
    await runDirection(scenario, direction);
    return;
  }
  try {
    await runDirection(scenario, direction);
  } catch (error) {
    // a seed-coverage violation is NEVER a legitimate "red as pinned" — it must
    // fail the corpus even inside a pinned scenario, so re-throw it.
    if (error instanceof SeedCoverageError) throw error;
    return; // red as pinned — fine
  }
  throw new Error(
    `${key} is pinned in EXPECTED_RED but now PASSES — remove the pin (tests/expected-red.ts)`,
  );
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
const ROLE_DDL = /\b(?:create|drop|alter)\s+(?:role|user|group)\b/i;
function mustRunSerially(scenario: Scenario): boolean {
  return (
    scenario.meta.isolatedCluster === true ||
    ROLE_DDL.test(scenario.a) ||
    ROLE_DDL.test(scenario.b) ||
    (scenario.seed !== undefined && ROLE_DDL.test(scenario.seed))
  );
}

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
        180_000,
      );
    }
  });
}
