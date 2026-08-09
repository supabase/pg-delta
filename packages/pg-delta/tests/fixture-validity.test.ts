/**
 * Fixture-validity layer (stage 0): every scenario's DDL applies cleanly.
 * Green independently of the engine — engine reds can only ever mean
 * "engine missing/broken", never "fixture broken".
 */
import { describe, expect, test } from "bun:test";
import { loadCorpus } from "./corpus.ts";
import {
  isolatedClusterPair,
  sharedCluster,
  type Cluster,
} from "./containers.ts";

describe("corpus fixture validity", () => {
  for (const scenario of loadCorpus()) {
    test(
      scenario.name,
      async () => {
        let clusterA: Cluster;
        let clusterB: Cluster;
        if (scenario.meta.isolatedCluster) {
          [clusterA, clusterB] = await isolatedClusterPair();
        } else {
          clusterA = clusterB = await sharedCluster();
        }
        if (scenario.meta.minVersion !== undefined) {
          if ((await clusterA.pgMajor()) < scenario.meta.minVersion) return;
        }
        const [baseA, baseB] = scenario.meta.isolatedCluster
          ? await Promise.all([clusterA.listRoles(), clusterB.listRoles()])
          : [null, null];
        const dbA = await clusterA.createDb("fv_a");
        const dbB = await clusterB.createDb("fv_b");
        try {
          await dbA.pool.query(scenario.a);
          await dbB.pool.query(scenario.b);
          if (scenario.seed) await dbA.pool.query(scenario.seed);
          expect(true).toBe(true);
        } finally {
          await Promise.all([dbA.drop(), dbB.drop()]);
          if (baseA && baseB) {
            await Promise.all([
              clusterA.dropRolesExcept(baseA),
              clusterB.dropRolesExcept(baseB),
            ]);
          }
        }
      },
      120_000,
    );
  }
});
