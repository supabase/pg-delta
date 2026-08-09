/**
 * Policy/filter integration parity (Tier 5): the v2 Policy DSL replaces the old
 * filter DSL (catalog-export-filter / filter-wildcard / security-label-filter).
 *
 * The predicate vocabulary (kind, schema/name glob, owner, not/any/all,
 * ownedByExtension, parentKind, first-match-wins filterDeltas) is exhaustively
 * unit-tested in src/policy/policy.test.ts, and managed-schema/role projection +
 * edgeTo provenance + concurrentIndexes live in tests/policy.test.ts. This file
 * pins the two end-to-end behaviors those do not cover:
 *   1. a schema-exclude policy projects a whole schema out of the plan and the
 *      kept view round-trips to zero drift (catalog-export-filter realtime use);
 *   2. security-label changes are excludable by kind and by provider — which
 *      requires a real label provider (seclabelCluster), so it is not corpus;
 *   3. a partitionOf-exclude policy leaves differing partition sets unmanaged
 *      on BOTH sides while the rest converges (the Realtime tenant-migration
 *      use — the old filter DSL's `table/is_partition`, #346).
 *
 * Intentional v2 deltas (recorded in the ledger, no test): filter-wildcard's
 * `requires` regex has no Policy v2 predicate, and the CLI `--filter`
 * AND-combine is an old-API shape. (Its `is_partition` boolean is superseded
 * by the `partitionOf` predicate, pinned in this file.)
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import type { Policy } from "../src/policy/policy.ts";
import {
  seclabelCluster,
  sharedCluster,
  skipSeclabelProof,
  type TestDb,
} from "./containers.ts";

describe("policy filter: schema projection roundtrip", () => {
  test("a schema-exclude policy plans only the kept schema and converges", async () => {
    const cluster = await sharedCluster();
    const main = await cluster.createDb("polf_schema_main");
    const desired = await cluster.createDb("polf_schema_dst");
    try {
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.users (id integer);
        CREATE SCHEMA analytics;
        CREATE TABLE analytics.events (id integer);
      `);
      // keep `app`, project out `analytics` (the object-in-schema rule + the
      // schema-object rule, mirroring how the old filterCatalog pruned a schema).
      const policy: Policy = {
        id: "keep-app",
        filter: [
          { match: { schema: ["analytics"] }, action: "exclude" },
          {
            match: { all: [{ kind: "schema" }, { name: ["analytics"] }] },
            action: "exclude",
          },
        ],
      };

      const [s, d] = await Promise.all([
        extract(main.pool),
        extract(desired.pool),
      ]);
      const thePlan = plan(s.factBase, d.factBase, { policy });

      const producesSchema = (name: string): boolean =>
        thePlan.actions.some((a) =>
          a.produces.some(
            (id) =>
              (id.kind === "schema" &&
                (id as { name: string }).name === name) ||
              ("schema" in id && (id as { schema: string }).schema === name),
          ),
        );
      expect(producesSchema("app")).toBe(true);
      expect(producesSchema("analytics")).toBe(false);
      // belt-and-suspenders: analytics never appears in any rendered SQL.
      expect(thePlan.actions.some((a) => /analytics/.test(a.sql))).toBe(false);

      // roundtrip: apply the kept plan, then re-plan under the same policy →
      // zero drift (analytics is unmanaged, app fully converged).
      const report = await apply(thePlan, main.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      const after = await extract(main.pool);
      expect(plan(after.factBase, d.factBase, { policy }).actions).toEqual([]);
    } finally {
      await Promise.all([main.drop(), desired.drop()]);
    }
  }, 60_000);
});

describe("policy filter: partitionOf projection roundtrip", () => {
  test("differing partition sets stay unmanaged on both sides; the rest converges", async () => {
    const cluster = await sharedCluster();
    const main = await cluster.createDb("polf_part_main");
    const desired = await cluster.createDb("polf_part_dst");
    try {
      // The Realtime tenant shape: both sides share the partitioned parent, but
      // carry DIFFERENT operationally-created partition sets (daily churn the
      // Realtime service owns). The desired side also adds a plain table that
      // the tenant migration SHOULD manage.
      await main.pool.query(`
        CREATE SCHEMA realtime;
        CREATE TABLE realtime.messages (
          id bigint NOT NULL,
          inserted_at timestamptz NOT NULL,
          PRIMARY KEY (id, inserted_at)
        ) PARTITION BY RANGE (inserted_at);
        CREATE TABLE realtime.messages_2026_08_01
          PARTITION OF realtime.messages
          FOR VALUES FROM ('2026-08-01') TO ('2026-08-02');
      `);
      await desired.pool.query(`
        CREATE SCHEMA realtime;
        CREATE TABLE realtime.messages (
          id bigint NOT NULL,
          inserted_at timestamptz NOT NULL,
          PRIMARY KEY (id, inserted_at)
        ) PARTITION BY RANGE (inserted_at);
        CREATE TABLE realtime.messages_2026_08_05
          PARTITION OF realtime.messages
          FOR VALUES FROM ('2026-08-05') TO ('2026-08-06');
        CREATE TABLE realtime.messages_2026_08_06
          PARTITION OF realtime.messages
          FOR VALUES FROM ('2026-08-06') TO ('2026-08-07');
        CREATE TABLE realtime.subscription (id bigint PRIMARY KEY);
      `);
      const policy: Policy = {
        id: "realtime-tenant",
        filter: [
          {
            match: { partitionOf: { schema: "realtime", name: "messages" } },
            action: "exclude",
            audit: { reasonCode: "realtime.messages-partition-churn" },
          },
        ],
      };

      const [s, d] = await Promise.all([
        extract(main.pool),
        extract(desired.pool),
      ]);
      const thePlan = plan(s.factBase, d.factBase, { policy });

      // no partition child is created or dropped in either direction …
      expect(thePlan.actions.some((a) => /messages_20/.test(a.sql))).toBe(
        false,
      );
      // … while the plain table IS planned.
      expect(thePlan.actions.some((a) => /subscription/.test(a.sql))).toBe(
        true,
      );

      const report = await apply(thePlan, main.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");

      // roundtrip: re-plan under the same policy → zero drift even though the
      // two sides still hold different partition sets.
      const after = await extract(main.pool);
      expect(plan(after.factBase, d.factBase, { policy }).actions).toEqual([]);

      // the churn partition on main was never dropped.
      const rows = await main.pool.query(
        `SELECT relname FROM pg_class WHERE relname = 'messages_2026_08_01'`,
      );
      expect(rows.rows).toHaveLength(1);
    } finally {
      await Promise.all([main.drop(), desired.drop()]);
    }
  }, 60_000);
});

describe.skipIf(skipSeclabelProof)("policy filter: security labels", () => {
  const dbs: TestDb[] = [];
  // dummy provider is preloaded by seclabelCluster (no CREATE EXTENSION needed);
  // its allowed vocabulary includes 'classified'.
  const LABELLED = `
    CREATE TABLE public.docs (id integer PRIMARY KEY);
    SECURITY LABEL FOR 'dummy' ON TABLE public.docs IS 'classified';
  `;

  async function planSql(policy?: Policy): Promise<string[]> {
    const cluster = await seclabelCluster();
    const main = await cluster.createDb("polf_sl_main");
    const desired = await cluster.createDb("polf_sl_dst");
    dbs.push(main, desired);
    await main.pool.query("CREATE TABLE public.docs (id integer PRIMARY KEY);");
    await desired.pool.query(LABELLED);
    const [s, d] = await Promise.all([
      extract(main.pool),
      extract(desired.pool),
    ]);
    return plan(s.factBase, d.factBase, policy ? { policy } : {}).actions.map(
      (a) => a.sql,
    );
  }

  test("without a filter, the SECURITY LABEL is planned (sanity)", async () => {
    const sql = await planSql();
    expect(sql.some((s) => /SECURITY LABEL FOR 'dummy'/.test(s))).toBe(true);
  }, 300_000);

  test("excludes all security-label changes by kind", async () => {
    const policy: Policy = {
      id: "no-seclabels",
      filter: [{ match: { kind: "securityLabel" }, action: "exclude" }],
    };
    const sql = await planSql(policy);
    expect(sql.some((s) => /SECURITY LABEL/.test(s))).toBe(false);
  }, 300_000);

  test("excludes security labels only for the matching provider", async () => {
    const policy: Policy = {
      id: "no-dummy-seclabels",
      filter: [
        {
          match: {
            all: [
              { kind: "securityLabel" },
              { idField: { field: "provider", glob: "dummy" } },
            ],
          },
          action: "exclude",
        },
      ],
    };
    const sql = await planSql(policy);
    expect(sql.some((s) => /SECURITY LABEL FOR 'dummy'/.test(s))).toBe(false);
  }, 300_000);
});
