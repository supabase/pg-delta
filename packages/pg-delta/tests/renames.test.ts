/**
 * Rename corpus (stage 9 gate): leaf rename, container rename, ambiguous
 * pair, near-miss degradation, swap case, and column-VALUE survival on
 * every auto rename (row counts can't see a column drop+create — values
 * can; this is the data-preservation point of the whole feature).
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { normalizeRoleIdentities } from "../src/plan/identity-normalize.ts";
import { plan } from "../src/plan/plan.ts";
import type { Policy } from "../src/policy/policy.ts";
import { provePlan } from "../src/proof/prove.ts";
import {
  isolatedClusterPair,
  sharedCluster,
  type TestDb,
} from "./containers.ts";

async function pair(
  prefix: string,
  fromSql: string,
  toSql: string,
): Promise<{ source: TestDb; desired: TestDb; drop: () => Promise<void> }> {
  const cluster = await sharedCluster();
  const source = await cluster.createDb(`${prefix}_src`);
  const desired = await cluster.createDb(`${prefix}_dst`);
  await source.pool.query(fromSql);
  await desired.pool.query(toSql);
  return {
    source,
    desired,
    drop: async () => {
      await Promise.all([source.drop(), desired.drop()]);
    },
  };
}

describe("stage 9: renames", () => {
  test("role rename referenced by an RLS policy plans and proves without a cycle", async () => {
    const [sourceCluster, desiredCluster] = await isolatedClusterPair();
    const source = await sourceCluster.createDb("ren_policy_src");
    const desired = await desiredCluster.createDb("ren_policy_dst");
    try {
      await sourceCluster.adminPool.query(`CREATE ROLE renpolicy_old NOLOGIN`);
      await sourceCluster.adminPool.query(
        `ALTER ROLE renpolicy_old SET statement_timeout = '42424ms'`,
      );
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.docs (id integer PRIMARY KEY);
        ALTER TABLE app.docs ENABLE ROW LEVEL SECURITY;
        CREATE POLICY docs_read ON app.docs
          FOR SELECT TO renpolicy_old USING (true);
      `);

      await desiredCluster.adminPool.query(`CREATE ROLE renpolicy_new NOLOGIN`);
      await desiredCluster.adminPool.query(
        `ALTER ROLE renpolicy_new SET statement_timeout = '42424ms'`,
      );
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.docs (id integer PRIMARY KEY);
        ALTER TABLE app.docs ENABLE ROW LEVEL SECURITY;
        CREATE POLICY docs_read ON app.docs
          FOR SELECT TO renpolicy_new USING (true);
      `);

      const [sourceState, desiredState] = await Promise.all([
        extract(source.pool),
        extract(desired.pool),
      ]);
      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        renames: "auto",
        compact: false,
      });

      expect(thePlan.actions.map((action) => action.sql))
        .toMatchInlineSnapshot(`
        [
          "ALTER ROLE "renpolicy_old" RENAME TO "renpolicy_new"",
        ]
      `);
      expect(thePlan.deltas).toEqual([]);
      expect(thePlan.source.fingerprint).toBe(sourceState.factBase.rootHash);
      const canonicalSource = normalizeRoleIdentities(
        sourceState.factBase,
        new Map([["renpolicy_old", "renpolicy_new"]]),
      );
      expect(canonicalSource.rootHash).not.toBe(sourceState.factBase.rootHash);
      const verdict = await provePlan(
        thePlan,
        source.pool,
        desiredState.factBase,
      );
      expect(verdict.applyError).toBeUndefined();
      expect(verdict.driftDeltas).toEqual([]);
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([
        source.drop().catch(() => {}),
        desired.drop().catch(() => {}),
      ]);
    }
  }, 120_000);

  test("canonical policy filtering vetoes an object rename and the projected target proves", async () => {
    const [sourceCluster, desiredCluster] = await isolatedClusterPair();
    const source = await sourceCluster.createDb("ren_filter_src");
    const desired = await desiredCluster.createDb("ren_filter_dst");
    const policy: Policy = {
      id: "canonical-owner-filter",
      filter: [
        {
          match: {
            all: [
              { kind: "table" },
              { name: "old_t" },
              { owner: "renfilter_new" },
              { verb: ["remove", "unlink"] },
            ],
          },
          action: "exclude",
        },
        {
          match: {
            all: [
              { kind: "acl" },
              {
                target: { kind: "table", schema: "app", name: "old_t" },
              },
              { verb: "remove" },
            ],
          },
          action: "exclude",
        },
      ],
    };

    try {
      await sourceCluster.adminPool.query(`CREATE ROLE renfilter_old NOLOGIN`);
      await sourceCluster.adminPool.query(
        `ALTER ROLE renfilter_old SET statement_timeout = '51515ms'`,
      );
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.old_t ();
        ALTER TABLE app.old_t OWNER TO renfilter_old;
      `);

      await desiredCluster.adminPool.query(`CREATE ROLE renfilter_new NOLOGIN`);
      await desiredCluster.adminPool.query(
        `ALTER ROLE renfilter_new SET statement_timeout = '51515ms'`,
      );
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.new_t ();
        ALTER TABLE app.new_t OWNER TO renfilter_new;
      `);

      const [sourceState, desiredState] = await Promise.all([
        extract(source.pool),
        extract(desired.pool),
      ]);
      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        renames: "auto",
        compact: false,
        policy,
      });
      const sql = thePlan.actions.map((action) => action.sql);

      expect(sql).toContain(
        'ALTER ROLE "renfilter_old" RENAME TO "renfilter_new"',
      );
      expect(
        sql.some(
          (statement) =>
            statement.includes("ALTER TABLE") &&
            statement.includes("RENAME TO"),
        ),
      ).toBe(false);
      expect(sql).toContain('CREATE TABLE "app"."new_t" ()');

      const verdict = await provePlan(
        thePlan,
        source.pool,
        desiredState.factBase,
      );
      expect(verdict.applyError).toBeUndefined();
      expect(verdict.driftDeltas).toEqual([]);
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([
        source.drop().catch(() => {}),
        desired.drop().catch(() => {}),
      ]);
    }
  }, 120_000);

  test("a filtered child delta vetoes its container rename and proves", async () => {
    const dbs = await pair(
      "ren_filter_child",
      `CREATE SCHEMA app;
       CREATE TABLE app.old_t (c integer);`,
      `CREATE SCHEMA app;
       CREATE TABLE app.new_t (c integer);`,
    );
    const policy: Policy = {
      id: "canonical-column-filter",
      filter: [
        {
          match: {
            all: [
              { kind: "column" },
              { name: "c" },
              { idField: { field: "table", glob: "new_t" } },
              { verb: "add" },
            ],
          },
          action: "exclude",
        },
      ],
    };

    try {
      const [sourceState, desiredState] = await Promise.all([
        extract(dbs.source.pool),
        extract(dbs.desired.pool),
      ]);
      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        renames: "auto",
        compact: false,
        policy,
      });

      expect(
        thePlan.actions.some(
          (action) =>
            action.sql.includes("ALTER TABLE") &&
            action.sql.includes("RENAME TO"),
        ),
      ).toBe(false);
      expect(thePlan.acceptedRenames).toBeUndefined();

      const verdict = await provePlan(
        thePlan,
        dbs.source.pool,
        desiredState.factBase,
      );
      expect(verdict.applyError).toBeUndefined();
      expect(verdict.driftDeltas).toEqual([]);
      expect(verdict.ok).toBe(true);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("an orphaned filtered source child preserves its container rename and data", async () => {
    const dbs = await pair(
      "ren_filter_orphan",
      `CREATE SCHEMA app;
       CREATE TABLE app.old_t (c integer);
       INSERT INTO app.old_t VALUES (42);`,
      `CREATE SCHEMA app;
       CREATE TABLE app.new_t (c integer);`,
    );
    const policy: Policy = {
      id: "orphaned-source-column-filter",
      filter: [
        {
          match: {
            all: [
              { kind: "column" },
              { name: "c" },
              { idField: { field: "table", glob: "old_t" } },
              { verb: "remove" },
            ],
          },
          action: "exclude",
        },
      ],
    };

    try {
      const [sourceState, desiredState] = await Promise.all([
        extract(dbs.source.pool),
        extract(dbs.desired.pool),
      ]);
      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        renames: "auto",
        compact: false,
        policy,
      });

      expect(thePlan.actions.map((action) => action.sql)).toEqual([
        'ALTER TABLE "app"."old_t" RENAME TO "new_t"',
      ]);
      const verdict = await provePlan(
        thePlan,
        dbs.source.pool,
        desiredState.factBase,
      );
      expect(verdict.applyError).toBeUndefined();
      expect(verdict.driftDeltas).toEqual([]);
      expect(verdict.dataViolations).toEqual([]);
      expect(verdict.ok).toBe(true);
      const rows = await dbs.source.pool.query(`SELECT c FROM app.new_t`);
      expect(rows.rows).toEqual([{ c: 42 }]);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("column leaf rename: emitted as RENAME COLUMN, values survive", async () => {
    const dbs = await pair(
      "ren_col",
      `CREATE SCHEMA app;
       CREATE TABLE app.users (id integer PRIMARY KEY, full_name text);
       INSERT INTO app.users VALUES (1, 'ada'), (2, 'grace');`,
      `CREATE SCHEMA app;
       CREATE TABLE app.users (id integer PRIMARY KEY, display_name text);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      const renameActions = thePlan.actions.filter((a) =>
        a.sql.includes("RENAME COLUMN"),
      );
      expect(renameActions).toHaveLength(1);
      // no drop+create of the column
      expect(
        thePlan.actions.filter(
          (a) => a.verb === "drop" && a.destroys[0]?.kind === "column",
        ),
      ).toHaveLength(0);
      const report = await apply(thePlan, dbs.source.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      const rows = await dbs.source.pool.query(
        `SELECT display_name FROM app.users ORDER BY id`,
      );
      // the VALUES survived — a drop+create would have nulled them
      expect(
        rows.rows.map((r) => (r as { display_name: string }).display_name),
      ).toEqual(["ada", "grace"]);
      const proven = await extract(dbs.source.pool);
      expect(proven.factBase.rootHash).toBe(d.factBase.rootHash);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("container rename: one ALTER TABLE RENAME, subtree emits nothing, rows survive", async () => {
    const dbs = await pair(
      "ren_tab",
      `CREATE SCHEMA app;
       CREATE TABLE app.old_name (id integer NOT NULL, note text DEFAULT 'x');
       INSERT INTO app.old_name VALUES (1, 'keep');`,
      `CREATE SCHEMA app;
       CREATE TABLE app.new_name (id integer NOT NULL, note text DEFAULT 'x');`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      // exactly one action: the rename (no column adds, no drops)
      expect(thePlan.actions).toHaveLength(1);
      expect(thePlan.actions[0]?.verb).toBe("alter");
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
      const rows = await dbs.source.pool.query(`SELECT note FROM app.new_name`);
      expect((rows.rows[0] as { note: string }).note).toBe("keep");
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("renamed table stays under data-preservation coverage (F7)", async () => {
    const dbs = await pair(
      "ren_cover",
      `CREATE SCHEMA app;
       CREATE TABLE app.old_name (id integer NOT NULL, note text DEFAULT 'x');
       INSERT INTO app.old_name VALUES (1, 'keep'), (2, 'stay');`,
      `CREATE SCHEMA app;
       CREATE TABLE app.new_name (id integer NOT NULL, note text DEFAULT 'x');`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
      // the renamed table is CHECKED under its NEW name, not skipped as
      // "dropped/recreated" — without the fix its old key lands in
      // recreatedTables and it gets ZERO data-preservation coverage (F7).
      const checked = verdict.coverage.perTable.find(
        (p) => p.table.schema === "app" && p.table.name === "new_name",
      );
      expect(checked).toBeDefined();
      expect(verdict.coverage.tablesSkipped).toEqual([]);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("undeclared row loss on a renamed table is caught (F7)", async () => {
    const dbs = await pair(
      "ren_loss",
      `CREATE SCHEMA app;
       CREATE TABLE app.old_name (id integer DEFAULT 1);
       INSERT INTO app.old_name SELECT generate_series(1, 5);`,
      `CREATE SCHEMA app;
       CREATE TABLE app.new_name (id integer DEFAULT 1);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      // inject a lie: after the rename, silently discard the rows but declare
      // dataLoss:none. The proof must catch it now that the renamed table is
      // covered (before the fix it was skipped as "dropped by the plan").
      thePlan.actions.push({
        sql: `TRUNCATE app.new_name`,
        verb: "alter",
        produces: [],
        consumes: [{ kind: "table", schema: "app", name: "new_name" }],
        destroys: [],
        releases: [],
        transactionality: "transactional",
        lockClass: "accessExclusive",
        newSegmentBefore: false,
        dataLoss: "none",
        rewriteRisk: false,
      });
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      // row count dropped 5 → 0 under the NEW name — a data violation
      expect(verdict.dataViolations).toEqual([
        { table: { schema: "app", name: "new_name" }, before: 5, after: 0 },
      ]);
      expect(verdict.ok).toBe(false);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("renames: 'off' (the default) preserves drop+create", async () => {
    const dbs = await pair(
      "ren_off",
      `CREATE SCHEMA app; CREATE TABLE app.old_name (id integer);`,
      `CREATE SCHEMA app; CREATE TABLE app.new_name (id integer);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase);
      expect(thePlan.renameCandidates).toHaveLength(0);
      expect(thePlan.actions.some((a) => a.sql.includes("RENAME"))).toBe(false);
      expect(thePlan.actions.some((a) => a.verb === "drop")).toBe(true);
      expect(thePlan.safetyReport.destructiveActions).toBeGreaterThan(0);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("'prompt' reports the candidate but applies only when accepted", async () => {
    const dbs = await pair(
      "ren_prompt",
      `CREATE SCHEMA app; CREATE TABLE app.old_name (id integer);`,
      `CREATE SCHEMA app; CREATE TABLE app.new_name (id integer);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const unconfirmed = plan(s.factBase, d.factBase, { renames: "prompt" });
      expect(unconfirmed.renameCandidates).toHaveLength(1);
      expect(unconfirmed.renameCandidates[0]?.status).toBe("unambiguous");
      // not accepted -> still drop+create
      expect(unconfirmed.actions.some((a) => a.verb === "drop")).toBe(true);

      const candidate = unconfirmed.renameCandidates[0]!;
      const confirmed = plan(s.factBase, d.factBase, {
        renames: "prompt",
        acceptRenames: [{ from: candidate.from, to: candidate.to }],
      });
      expect(confirmed.actions).toHaveLength(1);
      expect(confirmed.actions[0]?.sql).toContain("RENAME");
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("ambiguous pairs are reported, never guessed", async () => {
    const dbs = await pair(
      "ren_amb",
      `CREATE SCHEMA app;
       CREATE TABLE app.a1 (id integer);
       CREATE TABLE app.a2 (id integer);`,
      `CREATE SCHEMA app;
       CREATE TABLE app.b1 (id integer);
       CREATE TABLE app.b2 (id integer);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      const ambiguous = thePlan.renameCandidates.filter(
        (c) => c.status === "ambiguous",
      );
      expect(ambiguous.length).toBe(4); // 2 removed × 2 added
      // none applied: the plan still drops and creates
      expect(thePlan.actions.some((a) => a.sql.includes("RENAME"))).toBe(false);
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("a swap surfaces as set-deltas, never a guessed rename", async () => {
    const dbs = await pair(
      "ren_swap",
      `CREATE SCHEMA app;
       CREATE TABLE app.x (id integer);
       CREATE TABLE app.y (note text);`,
      `CREATE SCHEMA app;
       CREATE TABLE app.y (id integer);
       CREATE TABLE app.x (note text);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      // both table ids exist on both sides — the swap is column-level
      // set/remove/add deltas, so NO table rename candidate can exist
      expect(
        thePlan.renameCandidates.filter((c) => c.kind === "table"),
      ).toHaveLength(0);
      expect(
        thePlan.actions.some(
          (a) => a.sql.includes("ALTER TABLE") && a.sql.includes("RENAME TO"),
        ),
      ).toBe(false);
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("near-miss (index def embeds the table name) degrades to drop+create with a reason", async () => {
    const dbs = await pair(
      "ren_near",
      `CREATE SCHEMA app;
       CREATE TABLE app.old_name (id integer);
       CREATE INDEX old_idx ON app.old_name (id);`,
      `CREATE SCHEMA app;
       CREATE TABLE app.new_name (id integer);
       CREATE INDEX old_idx ON app.new_name (id);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      const nearMisses = thePlan.renameCandidates.filter(
        (c) => c.status === "nearMiss",
      );
      expect(nearMisses.length).toBeGreaterThan(0);
      expect(nearMisses[0]?.reason).toMatch(/subtree differs/);
      // degraded, but still correct end-to-end
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("schema container rename carries its whole subtree", async () => {
    const dbs = await pair(
      "ren_schema",
      `CREATE SCHEMA olds;
       CREATE TABLE olds.t (id integer DEFAULT 7);
       INSERT INTO olds.t VALUES (1);`,
      `CREATE SCHEMA news;
       CREATE TABLE news.t (id integer DEFAULT 7);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      expect(thePlan.actions).toHaveLength(1);
      expect(thePlan.actions[0]?.sql).toContain("ALTER SCHEMA");
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
      const rows = await dbs.source.pool.query(`SELECT id FROM news.t`);
      expect((rows.rows[0] as { id: number }).id).toBe(1);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("composite-type attribute rename: RENAME ATTRIBUTE, in-use, data survives", async () => {
    const dbs = await pair(
      "ren_attr",
      `CREATE SCHEMA app;
       CREATE TYPE app.addr AS (street text, city text);
       CREATE TABLE app.loc (id integer PRIMARY KEY, a app.addr);
       INSERT INTO app.loc VALUES (1, ROW('main', 'springfield'));`,
      `CREATE SCHEMA app;
       CREATE TYPE app.addr AS (street text, town text);
       CREATE TABLE app.loc (id integer PRIMARY KEY, a app.addr);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      const renameAction = thePlan.actions.find((a) =>
        a.sql.includes("RENAME ATTRIBUTE"),
      );
      expect(renameAction?.sql).toContain(`RENAME ATTRIBUTE "city" TO "town"`);
      // no drop+re-add of the attribute (that would lose the sub-field data)
      expect(
        thePlan.actions.some((a) => a.sql.includes("DROP ATTRIBUTE")),
      ).toBe(false);
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
      const rows = await dbs.source.pool.query(
        `SELECT (a).street, (a).town FROM app.loc`,
      );
      expect(rows.rows[0]).toEqual({ street: "main", town: "springfield" });
    } finally {
      await dbs.drop();
    }
  }, 60_000);
});
