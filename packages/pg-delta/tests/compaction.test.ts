/**
 * Compaction (§3.6, stage 5 deliverable 4): cosmetic by contract.
 * The gate: proof results are IDENTICAL with compaction on and off, and
 * the compacted plan folds column clauses into CREATE TABLE (asserted as
 * action-shape budgets, never SQL bytes).
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { probeApplierCapability } from "../src/policy/capability.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster } from "./containers.ts";

const RICH_SCHEMA = `
  CREATE SCHEMA app;
  CREATE SEQUENCE app.id_seq;
  CREATE TABLE app.users (
    id integer NOT NULL DEFAULT nextval('app.id_seq'),
    email text NOT NULL,
    score numeric(10,2) DEFAULT 0.0,
    PRIMARY KEY (id)
  );
  CREATE TABLE app.events (created_at timestamptz NOT NULL, payload text)
    PARTITION BY RANGE (created_at);
  CREATE TABLE app.events_2026 PARTITION OF app.events
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
  CREATE INDEX users_email_idx ON app.users (email);
  CREATE VIEW app.v AS SELECT id, email FROM app.users;
`;

describe("compaction", () => {
  test("proof results identical with compaction on and off; compacted plan is smaller", async () => {
    const cluster = await sharedCluster();
    const desired = await cluster.createDb("compact_dst");
    const cloneA = await cluster.createDb("compact_a");
    const cloneB = await cluster.createDb("compact_b");
    try {
      await desired.pool.query(RICH_SCHEMA);
      const desiredState = await extract(desired.pool);
      const emptyA = await extract(cloneA.pool);
      const emptyB = await extract(cloneB.pool);

      const compacted = plan(emptyA.factBase, desiredState.factBase);
      const decomposed = plan(emptyB.factBase, desiredState.factBase, {
        compact: false,
      });

      // shape budget: the compacted plan folded the users columns
      expect(compacted.actions.length).toBeLessThan(decomposed.actions.length);
      const addColumns = compacted.actions.filter(
        (a) => a.verb === "create" && a.produces[0]?.kind === "column",
      );
      // partitioned-parent columns were already inlined pre-compaction;
      // the plain table's columns must now be folded too
      expect(addColumns).toHaveLength(0);

      const [verdictA, verdictB] = [
        await provePlan(compacted, cloneA.pool, desiredState.factBase),
        await provePlan(decomposed, cloneB.pool, desiredState.factBase),
      ];
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
    } finally {
      await Promise.all([desired.drop(), cloneA.drop(), cloneB.drop()]);
    }
  }, 120_000);

  test("a column whose dependency lands between CREATE TABLE and the column stays unfolded", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("compact_nf_src");
    const desired = await cluster.createDb("compact_nf_dst");
    try {
      // the enum value-set migration alters the type AFTER the new table
      // would be created — a column of that type cannot fold across it
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.status AS ENUM ('a', 'b', 'c');
        CREATE TABLE app.existing (s app.status);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.status AS ENUM ('a', 'c');
        CREATE TABLE app.existing (s app.status);
        CREATE TABLE app.fresh (s app.status, note text);
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase);
      const verdict = await provePlan(
        thePlan,
        source.pool,
        desiredState.factBase,
      );
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("ACL replace: redundant REVOKE elided when compacted; same proof on/off", async () => {
    const cluster = await sharedCluster();
    const srcA = await cluster.createDb("compact_acl_a");
    const srcB = await cluster.createDb("compact_acl_b");
    const desired = await cluster.createDb("compact_acl_dst");
    await cluster.adminPool
      .query(`CREATE ROLE compact_acl_grantee NOLOGIN`)
      .catch(() => {});
    try {
      const seed = `
        CREATE SCHEMA app;
        CREATE TABLE app.t (id int);
        GRANT SELECT ON app.t TO compact_acl_grantee;
      `;
      await srcA.pool.query(seed);
      await srcB.pool.query(seed);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id int);
        GRANT SELECT, INSERT ON app.t TO compact_acl_grantee;
      `);
      const [aState, bState, desiredState] = [
        await extract(srcA.pool),
        await extract(srcB.pool),
        await extract(desired.pool),
      ];

      const compacted = plan(aState.factBase, desiredState.factBase);
      const decomposed = plan(bState.factBase, desiredState.factBase, {
        compact: false,
      });

      const revokes = (p: typeof compacted) =>
        p.actions.filter((x) => x.sql.includes("REVOKE ALL ON TABLE")).length;
      // the create's self-resetting REVOKE makes the replace's drop redundant
      expect(revokes(decomposed)).toBe(2);
      expect(revokes(compacted)).toBe(1);

      // …and the elided plan is still correct: same clean proof, on and off
      const [verdictA, verdictB] = [
        await provePlan(compacted, srcA.pool, desiredState.factBase),
        await provePlan(decomposed, srcB.pool, desiredState.factBase),
      ];
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
    } finally {
      await Promise.all([srcA.drop(), srcB.drop(), desired.drop()]);
    }
  }, 120_000);

  test("default-ACL elision: a fresh CREATE emits no default REVOKE/GRANT; same proof on/off", async () => {
    const cluster = await sharedCluster();
    const cloneA = await cluster.createDb("compact_defacl_a");
    const cloneB = await cluster.createDb("compact_defacl_b");
    const desired = await cluster.createDb("compact_defacl_dst");
    try {
      // a type (PUBLIC USAGE + owner USAGE are PG defaults) and a table
      // (owner gets the full default set, PUBLIC gets nothing) — both fresh.
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.mood AS ENUM ('sad', 'ok', 'happy');
        CREATE TABLE app.t (id int);
      `);
      const desiredState = await extract(desired.pool);
      const emptyA = await extract(cloneA.pool);
      const emptyB = await extract(cloneB.pool);

      const compacted = plan(emptyA.factBase, desiredState.factBase);
      const decomposed = plan(emptyB.factBase, desiredState.factBase, {
        compact: false,
      });

      // the decomposed plan spells out the default REVOKE/GRANT pairs…
      const defaultAclNoise = (p: typeof compacted) =>
        p.actions.filter(
          (a) =>
            a.sql.startsWith("REVOKE ALL ON") || a.sql.startsWith("GRANT "),
        ).length;
      expect(defaultAclNoise(decomposed)).toBeGreaterThan(0);
      // …and the compacted plan elides every one of them (all grants here are
      // built-in defaults on co-created objects).
      expect(defaultAclNoise(compacted)).toBe(0);
      expect(compacted.actions.length).toBeLessThan(decomposed.actions.length);

      // cosmetic by contract: identical clean proof with elision on and off.
      const [verdictA, verdictB] = [
        await provePlan(compacted, cloneA.pool, desiredState.factBase),
        await provePlan(decomposed, cloneB.pool, desiredState.factBase),
      ];
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
    } finally {
      await Promise.all([cloneA.drop(), cloneB.drop(), desired.drop()]);
    }
  }, 120_000);

  test("generated columns stay as ADD COLUMN so dependency columns exist first", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("compact_gen_src");
    const desired = await cluster.createDb("compact_gen_dst");
    try {
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (
          base int NOT NULL,
          doubled int GENERATED ALWAYS AS (base * 2) STORED
        );
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase);
      const createTable = thePlan.actions.find(
        (a) => a.verb === "create" && a.produces[0]?.kind === "table",
      );
      expect(createTable?.sql).not.toContain("GENERATED ALWAYS AS");
      const addGenerated = thePlan.actions.find((a) =>
        a.sql.includes("GENERATED ALWAYS AS"),
      );
      expect(addGenerated?.sql).toMatch(/ADD COLUMN.*GENERATED ALWAYS AS/);

      const verdict = await provePlan(
        thePlan,
        source.pool,
        desiredState.factBase,
      );
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("co-create ownership fold: schema AUTHORIZATION + applier-owner ALTER elided (4→2); same proof on/off", async () => {
    const cluster = await sharedCluster();
    const cloneA = await cluster.createDb("compact_own_a");
    const cloneB = await cluster.createDb("compact_own_b");
    const desired = await cluster.createDb("compact_own_dst");
    try {
      // a bare schema + table, both freshly created and owned by the applier
      // (`test`). Decomposed: CREATE SCHEMA, ALTER SCHEMA OWNER, CREATE TABLE,
      // ALTER TABLE OWNER (4). Compacted: CREATE SCHEMA … AUTHORIZATION test,
      // CREATE TABLE (2) — schema owner folded, table owner ALTER elided.
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id int);
      `);
      const desiredState = await extract(desired.pool);
      const emptyA = await extract(cloneA.pool);
      const emptyB = await extract(cloneB.pool);
      // probe the applier (connection user `test`) so the no-op owner ALTER is
      // elided exactly as it would be at apply time.
      const capability = await probeApplierCapability(cloneA.pool);

      const compacted = plan(emptyA.factBase, desiredState.factBase, {
        capability,
      });
      const decomposed = plan(emptyB.factBase, desiredState.factBase, {
        compact: false,
        capability,
      });

      const owns = (p: typeof compacted) =>
        p.actions.filter((a) => a.sql.includes(" OWNER TO ")).length;
      // decomposed spells out both owner ALTERs; compacted has none
      expect(owns(decomposed)).toBe(2);
      expect(owns(compacted)).toBe(0);
      // the headline win: schema + table, two statements, no owner residue
      expect(compacted.actions).toHaveLength(2);
      expect(compacted.actions[0]?.sql).toBe(
        `CREATE SCHEMA "app" AUTHORIZATION "test"`,
      );
      expect(compacted.actions[1]?.sql).toContain(`CREATE TABLE "app"."t"`);
      expect(decomposed.actions.length).toBeGreaterThan(
        compacted.actions.length,
      );

      const [verdictA, verdictB] = [
        await provePlan(compacted, cloneA.pool, desiredState.factBase),
        await provePlan(decomposed, cloneB.pool, desiredState.factBase),
      ];
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
    } finally {
      await Promise.all([cloneA.drop(), cloneB.drop(), desired.drop()]);
    }
  }, 120_000);

  test("co-create REVOKE elision: third-party grant keeps GRANT, drops leading REVOKE; same proof on/off", async () => {
    const cluster = await sharedCluster();
    const cloneA = await cluster.createDb("compact_corevoke_a");
    const cloneB = await cluster.createDb("compact_corevoke_b");
    const desired = await cluster.createDb("compact_corevoke_dst");
    await cluster.adminPool
      .query(`CREATE ROLE compact_co_grantee NOLOGIN`)
      .catch(() => {});
    try {
      // a fresh type with a third-party USAGE grant (the grantee has no default
      // privilege) — the leading REVOKE ALL is cosmetic.
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.mood AS ENUM ('a', 'b');
        GRANT USAGE ON TYPE app.mood TO compact_co_grantee;
      `);
      const desiredState = await extract(desired.pool);
      const emptyA = await extract(cloneA.pool);
      const emptyB = await extract(cloneB.pool);
      const capability = await probeApplierCapability(cloneA.pool);

      const compacted = plan(emptyA.factBase, desiredState.factBase, {
        capability,
      });
      const decomposed = plan(emptyB.factBase, desiredState.factBase, {
        compact: false,
        capability,
      });

      const grantSql = `GRANT USAGE ON TYPE "app"."mood" TO "compact_co_grantee"`;
      const revokeSql = `REVOKE ALL ON TYPE "app"."mood" FROM "compact_co_grantee"`;
      // decomposed keeps the REVOKE+GRANT pair…
      expect(decomposed.actions.map((a) => a.sql)).toContain(revokeSql);
      expect(decomposed.actions.map((a) => a.sql)).toContain(grantSql);
      // …compacted drops the REVOKE but keeps the load-bearing GRANT
      expect(compacted.actions.map((a) => a.sql)).not.toContain(revokeSql);
      expect(compacted.actions.map((a) => a.sql)).toContain(grantSql);

      const [verdictA, verdictB] = [
        await provePlan(compacted, cloneA.pool, desiredState.factBase),
        await provePlan(decomposed, cloneB.pool, desiredState.factBase),
      ];
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
    } finally {
      await Promise.all([cloneA.drop(), cloneB.drop(), desired.drop()]);
    }
  }, 120_000);

  test("multi-grantee merge: same-privilege co-create grants collapse into one GRANT; same proof on/off", async () => {
    const cluster = await sharedCluster();
    const cloneA = await cluster.createDb("compact_mrg_a");
    const cloneB = await cluster.createDb("compact_mrg_b");
    const desired = await cluster.createDb("compact_mrg_dst");
    for (const r of ["compact_mrg_r1", "compact_mrg_r2", "compact_mrg_r3"]) {
      await cluster.adminPool.query(`CREATE ROLE ${r} NOLOGIN`).catch(() => {});
    }
    try {
      // the fresh Supabase-style shape: one table, the same full privilege set
      // granted to several roles. Compacted, the per-grantee statements merge
      // into a single grantee-list GRANT.
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.notes (
          id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE app.notes ENABLE ROW LEVEL SECURITY;
        GRANT ALL ON TABLE app.notes TO compact_mrg_r1, compact_mrg_r2, compact_mrg_r3;
      `);
      const desiredState = await extract(desired.pool);
      const emptyA = await extract(cloneA.pool);
      const emptyB = await extract(cloneB.pool);

      const compacted = plan(emptyA.factBase, desiredState.factBase);
      const decomposed = plan(emptyB.factBase, desiredState.factBase, {
        compact: false,
      });

      // the owner's default-ACL groups (table + identity sequence) are a
      // separate concern (elided only under compaction) — scope to the roles.
      const roleGrants = (p: typeof compacted) =>
        p.actions.filter(
          (a) => a.sql.startsWith("GRANT ") && a.sql.includes(`"compact_mrg_r`),
        );
      // decomposed keeps pg_dump's one-statement-per-grantee model…
      expect(roleGrants(decomposed)).toHaveLength(3);
      // …compacted merges the run into a single grantee-list statement
      expect(roleGrants(compacted)).toHaveLength(1);
      expect(roleGrants(compacted)[0]?.sql).toContain(
        `TO "compact_mrg_r1", "compact_mrg_r2", "compact_mrg_r3"`,
      );

      const [verdictA, verdictB] = [
        await provePlan(compacted, cloneA.pool, desiredState.factBase),
        await provePlan(decomposed, cloneB.pool, desiredState.factBase),
      ];
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
    } finally {
      await Promise.all([cloneA.drop(), cloneB.drop(), desired.drop()]);
    }
  }, 120_000);

  test("executor-safe constraint fold: PK/UNIQUE/CHECK inline into CREATE TABLE, FK stays ALTER; same proof on/off", async () => {
    const cluster = await sharedCluster();
    const cloneA = await cluster.createDb("compact_cfold_a");
    const cloneB = await cluster.createDb("compact_cfold_b");
    const desired = await cluster.createDb("compact_cfold_dst");
    try {
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.notes (
          id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
          score int NOT NULL,
          CONSTRAINT notes_pkey PRIMARY KEY (id),
          CONSTRAINT notes_score_check CHECK (score >= 0),
          CONSTRAINT notes_score_key UNIQUE (score)
        );
        CREATE TABLE app.tags (
          id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          note_id bigint NOT NULL,
          CONSTRAINT tags_note_id_fkey FOREIGN KEY (note_id) REFERENCES app.notes(id)
        );
      `);
      const desiredState = await extract(desired.pool);
      const emptyA = await extract(cloneA.pool);
      const emptyB = await extract(cloneB.pool);

      const compacted = plan(emptyA.factBase, desiredState.factBase);
      const decomposed = plan(emptyB.factBase, desiredState.factBase, {
        compact: false,
      });

      const createNotes = compacted.actions.find((a) =>
        a.sql.startsWith(`CREATE TABLE "app"."notes"`),
      );
      // the self-contained constraints fold into the co-created table's parens…
      expect(createNotes?.sql).toContain(
        `CONSTRAINT "notes_pkey" PRIMARY KEY (id)`,
      );
      expect(createNotes?.sql).toContain(
        `CONSTRAINT "notes_score_check" CHECK`,
      );
      expect(createNotes?.sql).toContain(
        `CONSTRAINT "notes_score_key" UNIQUE (score)`,
      );
      // …while the FK — whose referenced table the executor may not have
      // created yet in the general case — stays a separate ALTER.
      const alters = compacted.actions.filter((a) =>
        a.sql.includes("ADD CONSTRAINT"),
      );
      expect(alters.map((a) => a.sql)).toEqual([
        `ALTER TABLE "app"."tags" ADD CONSTRAINT "tags_note_id_fkey" FOREIGN KEY (note_id) REFERENCES app.notes(id)`,
      ]);
      // decomposed keeps one ALTER per constraint
      expect(
        decomposed.actions.filter((a) => a.sql.includes("ADD CONSTRAINT"))
          .length,
      ).toBeGreaterThanOrEqual(5);

      const [verdictA, verdictB] = [
        await provePlan(compacted, cloneA.pool, desiredState.factBase),
        await provePlan(decomposed, cloneB.pool, desiredState.factBase),
      ];
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
    } finally {
      await Promise.all([cloneA.drop(), cloneB.drop(), desired.drop()]);
    }
  }, 120_000);

  test("co-create REVOKE elision: subset default keeps the load-bearing REVOKE; converges on/off", async () => {
    const cluster = await sharedCluster();
    const cloneA = await cluster.createDb("compact_subset_a");
    const cloneB = await cluster.createDb("compact_subset_b");
    const desired = await cluster.createDb("compact_subset_dst");
    await cluster.adminPool
      .query(`CREATE ROLE compact_subset_grantee NOLOGIN`)
      .catch(() => {});
    try {
      // applier (`test`) carries a default privilege granting SELECT+INSERT on
      // tables in `app` to the grantee; the table's explicit ACL keeps only
      // SELECT. The leading REVOKE ALL is load-bearing — without it the
      // create-time default INSERT would survive. The superset guard must keep
      // it (capability.role === test === the default's role).
      await desired.pool.query(`
        CREATE SCHEMA app;
        ALTER DEFAULT PRIVILEGES FOR ROLE test IN SCHEMA app
          GRANT SELECT, INSERT ON TABLES TO compact_subset_grantee;
        CREATE TABLE app.t (id int);
        REVOKE INSERT ON app.t FROM compact_subset_grantee;
      `);
      const desiredState = await extract(desired.pool);
      const emptyA = await extract(cloneA.pool);
      const emptyB = await extract(cloneB.pool);
      const capability = await probeApplierCapability(cloneA.pool);

      const compacted = plan(emptyA.factBase, desiredState.factBase, {
        capability,
      });
      const decomposed = plan(emptyB.factBase, desiredState.factBase, {
        compact: false,
        capability,
      });

      const revokeSql = `REVOKE ALL ON TABLE "app"."t" FROM "compact_subset_grantee"`;
      // the guard keeps the REVOKE even under compaction
      expect(compacted.actions.map((a) => a.sql)).toContain(revokeSql);

      const [verdictA, verdictB] = [
        await provePlan(compacted, cloneA.pool, desiredState.factBase),
        await provePlan(decomposed, cloneB.pool, desiredState.factBase),
      ];
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
    } finally {
      await Promise.all([cloneA.drop(), cloneB.drop(), desired.drop()]);
    }
  }, 120_000);

  test("co-create REVOKE elision: dropping the kept REVOKE would diverge (guard is load-bearing)", async () => {
    // The subset test above proves the engine KEEPS the REVOKE. This proves the
    // necessity, deterministically at the catalog level: with a create-time
    // default of SELECT+INSERT for the grantee, applying the kept GRANT SELECT
    // WITHOUT the leading REVOKE leaves the default INSERT behind, so the state
    // does NOT converge to the SELECT-only desired. (Explicit SQL order — the
    // default privilege is established before the table — so this never depends
    // on plan action ordering.)
    const cluster = await sharedCluster();
    const clone = await cluster.createDb("compact_subsetneg_clone");
    const desired = await cluster.createDb("compact_subsetneg_dst");
    await cluster.adminPool
      .query(`CREATE ROLE compact_subsetneg_grantee NOLOGIN`)
      .catch(() => {});
    try {
      const setup = (withRevoke: boolean) => `
        CREATE SCHEMA app;
        ALTER DEFAULT PRIVILEGES FOR ROLE test IN SCHEMA app
          GRANT SELECT, INSERT ON TABLES TO compact_subsetneg_grantee;
        CREATE TABLE app.t (id int);
        ${withRevoke ? "REVOKE ALL ON app.t FROM compact_subsetneg_grantee;" : ""}
        GRANT SELECT ON app.t TO compact_subsetneg_grantee;
      `;
      // desired = the engine's kept-REVOKE form (converges to SELECT only)
      await desired.pool.query(setup(true));
      // the REVOKE-dropped form leaves the default-granted INSERT in place
      await clone.pool.query(setup(false));
      const [desiredState, cloneState] = [
        await extract(desired.pool),
        await extract(clone.pool),
      ];
      expect(cloneState.factBase.rootHash).not.toBe(
        desiredState.factBase.rootHash,
      );
    } finally {
      await Promise.all([clone.drop(), desired.drop()]);
    }
  }, 120_000);
});
