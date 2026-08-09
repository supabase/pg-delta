/**
 * The generative soak (stage 3 / stage 10): seeded random schema pairs
 * through the FULL proof loop, both directions. The default batch keeps CI
 * honest; PGDELTA_NEXT_SOAK=<n> scales the run (a sustained soak is the
 * stage-10 parity-bar item). Every failure prints its seed — the seed IS
 * the repro case.
 *
 * A generated script that fails to LOAD is skipped (the generator emits
 * SQL mutations without elaborating dependencies — Postgres adjudicates);
 * a loaded pair that fails to PROVE is a real engine bug and fails the
 * suite.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster } from "./containers.ts";
import { generatePair, KIND_COVERAGE } from "./generative/generator.ts";

const BATCH = Number(process.env["PGDELTA_NEXT_SOAK"] ?? 12);
const SEED_BASE = Number(process.env["PGDELTA_NEXT_SOAK_SEED"] ?? 1000);

describe("generative soak", () => {
  test("kind-coverage checklist has no silent gaps", () => {
    for (const [kind, covered] of Object.entries(KIND_COVERAGE)) {
      // every entry is either covered or carries a written reason
      if (typeof covered === "string") {
        expect(covered.length).toBeGreaterThan(10);
      } else {
        expect(covered).toBe(true);
      }
      expect(kind.length).toBeGreaterThan(0);
    }
  });

  test(
    `${BATCH} seeded roundtrips prove in both directions`,
    async () => {
      const cluster = await sharedCluster();
      let proven = 0;
      let skippedUnloadable = 0;
      const failures: string[] = [];

      for (let i = 0; i < BATCH; i++) {
        const seed = SEED_BASE + i;
        const pair = generatePair(seed);
        // the proof MUTATES the source db: each direction gets fresh dbs
        for (const dir of ["forward", "reverse"] as const) {
          const [fromSql, toSql] =
            dir === "forward" ? [pair.a, pair.b] : [pair.b, pair.a];
          const source = await cluster.createDb(`gen_${dir}_src_${seed}`);
          const desired = await cluster.createDb(`gen_${dir}_dst_${seed}`);
          try {
            try {
              await source.pool.query(fromSql);
              await desired.pool.query(toSql);
            } catch {
              skippedUnloadable++;
              break; // unloadable script — not an engine problem
            }
            const [s, d] = [
              await extract(source.pool),
              await extract(desired.pool),
            ];
            const thePlan = plan(s.factBase, d.factBase);
            const verdict = await provePlan(thePlan, source.pool, d.factBase);
            if (!verdict.ok) {
              failures.push(
                `seed ${seed} (${dir}): ${
                  verdict.applyError
                    ? `apply failed: ${verdict.applyError.message} at "${verdict.applyError.sql}"`
                    : `drift=${verdict.driftDeltas.length} data=${verdict.dataViolations.length}`
                }`,
              );
              break;
            }
            proven++;
          } finally {
            await Promise.all([source.drop(), desired.drop()]);
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `generative soak failures (seeds are repro cases):\n  ${failures.join("\n  ")}`,
        );
      }
      // the batch must do real work — an all-skip run proves nothing
      expect(proven).toBeGreaterThanOrEqual(BATCH);
      expect(skippedUnloadable).toBeLessThan(BATCH / 2);
    },
    20 * 60_000,
  );
});
