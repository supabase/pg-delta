/**
 * aclexplode() emits one row per (grantee, GRANTOR). When the same privilege is
 * granted to one grantee by two different grantors, the per-grantee aggregation
 * recorded the privilege name TWICE — the rendered `GRANT SELECT, SELECT …` is
 * collapsed by Postgres on apply, so a re-extract no longer matches and the proof
 * drifts. Regression: privileges/grantable must be de-duplicated across grantors.
 * Docker required.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { sharedCluster } from "./containers.ts";

describe("acl: privileges de-duplicated across grantors", () => {
  test("same privilege from two grantors yields a single entry", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("acl_dedup");
    const [a, b, x] = ["fix4_granta", "fix4_grantb", "fix4_grantee"];
    try {
      await db.pool.query(`CREATE ROLE ${a}`);
      await db.pool.query(`CREATE ROLE ${b}`);
      await db.pool.query(`CREATE ROLE ${x}`);
      await db.pool.query(`
        CREATE TABLE public.t (id int);
        GRANT SELECT ON public.t TO ${a} WITH GRANT OPTION;
        GRANT SELECT ON public.t TO ${b} WITH GRANT OPTION;
        SET ROLE ${a}; GRANT SELECT ON public.t TO ${x}; RESET ROLE;
        SET ROLE ${b}; GRANT SELECT ON public.t TO ${x}; RESET ROLE;
      `);

      const state = await extract(db.pool);
      const aclFact = state.factBase
        .facts()
        .find(
          (f) =>
            f.id.kind === "acl" &&
            (f.id as { grantee: string }).grantee === x &&
            (f.id as { column?: string }).column === undefined,
        );
      expect(aclFact).toBeDefined();
      const privileges = aclFact!.payload["privileges"] as string[];
      // RED before the fix: ['SELECT', 'SELECT'] (one per grantor)
      expect(privileges).toEqual(["SELECT"]);
    } finally {
      await db.drop();
      for (const r of [a, b, x]) {
        await cluster.adminPool
          .query(`DROP OWNED BY ${r} CASCADE`)
          .catch(() => {});
        await cluster.adminPool
          .query(`DROP ROLE IF EXISTS ${r}`)
          .catch(() => {});
      }
    }
  }, 120_000);
});
