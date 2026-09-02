#!/usr/bin/env bun
/**
 * Reproduces the worker crash seen on `init_migration`: a connection that
 * drops while pg-delta is mid-flight ("Connection terminated unexpectedly" /
 * "read ECONNRESET") escapes as an uncaught exception and takes the host
 * process down, instead of failing the job.
 *
 * Mechanism under test: `pg` emits `error` on a client whose socket ends
 * unexpectedly; pg-pool removes its own listener while a client is checked
 * out; neither `extract` nor `apply` attaches one to the client they hold, and
 * a `pool.on("error")` handler (what the worker installs) only covers IDLE
 * clients. Without a listener, the `error` event is an uncaught exception.
 *
 * Setup: a disposable Postgres, a small fixture, a latency proxy in front of
 * the target so the socket can be cut from this process without superuser
 * rights. Two scenarios, each in a fresh target: the cut lands during
 * `extract`, then during `apply`. The script installs an
 * `uncaughtException` handler purely to REPORT (it records the error and keeps
 * going); in a real worker there is none, so each "uncaught" line below is a
 * process exit in production.
 *
 *   node --experimental-transform-types scripts/repro-dropped-connection.ts
 */
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { resolveProfile, supabaseProfile } from "../src/integrations/index.ts";
import { plan } from "../src/plan/plan.ts";
import {
  startLatencyProxy,
  upstreamOf,
  viaProxy,
} from "./lib/latency-proxy.ts";

const uncaught: string[] = [];
process.on("uncaughtException", (error) => {
  uncaught.push(`${error.name}: ${error.message}`);
});
process.on("unhandledRejection", (reason) => {
  uncaught.push(`unhandledRejection: ${String(reason)}`);
});

function fixture(tables: number): string {
  const parts = ["CREATE SCHEMA app;"];
  for (let t = 0; t < tables; t++) {
    parts.push(
      `CREATE TABLE app.t${t} (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL, created_at timestamptz DEFAULT now());`,
      `CREATE INDEX t${t}_name_idx ON app.t${t} (name);`,
      `COMMENT ON TABLE app.t${t} IS 'table ${t}';`,
    );
  }
  return parts.join("\n");
}

function makePool(uri: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: uri, max: 1 });
  // Same as the worker: idle-client errors are swallowed.
  pool.on("error", () => {});
  return pool;
}

async function settle(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

process.env["PGDELTA_TEST_IMAGE"] ??= "postgres:16-alpine";
const { sharedCluster } = await import("../tests/containers.ts");
const cluster = await sharedCluster();
const source = await cluster.createDb("drop_src");
await source.pool.query(fixture(60));

interface Outcome {
  scenario: string;
  /** what the awaited pg-delta call did */
  callResult: string;
  /** uncaught errors that reached the process while it ran */
  uncaught: string[];
}
const outcomes: Outcome[] = [];

async function scenario(
  name: string,
  cutDuring: "extract" | "apply",
): Promise<void> {
  const target = await cluster.createDb("drop_tgt");
  // 40 ms RTT gives the cut a wide window to land mid-phase.
  const proxy = await startLatencyProxy(upstreamOf(target.uri), 20);
  const targetPool = makePool(viaProxy(target.uri, proxy));
  const sourcePool = makePool(source.uri);
  uncaught.length = 0;
  let callResult = "";
  try {
    const profile = await resolveProfile(targetPool, supabaseProfile);
    if (cutDuring === "extract") {
      const cut = settle(150).then(() => proxy.dropConnections());
      try {
        await profile.extract(targetPool, { concurrency: 1 });
        callResult = "extract resolved";
      } catch (error) {
        callResult = `extract rejected: ${(error as Error).message}`;
      }
      await cut;
    } else {
      const [t, s] = await Promise.all([
        profile.extract(targetPool),
        profile.extract(sourcePool),
      ]);
      const migration = plan(t.factBase, s.factBase, {
        ...profile.planOptions,
        renames: "off",
        compact: true,
      });
      let cutAt = -1;
      const report = await apply(migration, targetPool, {
        ...profile.applyOptions,
        fingerprintGate: false,
        onEvent: (event) => {
          if (event.kind === "actionStart" && event.actionIndex === 20) {
            cutAt = event.actionIndex;
            proxy.dropConnections();
          }
        },
      });
      callResult = `apply returned status=${report.status} applied=${report.appliedActions}/${migration.actions.length} (cut at action ${cutAt})${report.error ? `: ${report.error.message}` : ""}`;
    }
  } catch (error) {
    callResult = `threw: ${(error as Error).message}`;
  }
  // Give the socket-level error events time to fire.
  await settle(300);
  outcomes.push({ scenario: name, callResult, uncaught: [...uncaught] });
  await Promise.allSettled([targetPool.end(), sourcePool.end()]);
  await proxy.close();
  await target.drop();
}

await scenario("connection dropped during extract", "extract");
await scenario("connection dropped during apply", "apply");

console.log("");
for (const o of outcomes) {
  console.log(`${o.scenario}`);
  console.log(`  call:     ${o.callResult}`);
  if (o.uncaught.length === 0) {
    console.log("  uncaught: none — a worker would have survived");
  } else {
    for (const u of o.uncaught) {
      console.log(`  uncaught: ${u}   <- process exit in a real worker`);
    }
  }
}

await source.drop();
await cluster.stop();
process.exit(0);
