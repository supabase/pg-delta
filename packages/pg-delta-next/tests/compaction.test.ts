/**
 * Compaction (§3.6, stage 5 deliverable 4): cosmetic by contract.
 * The gate: proof results are IDENTICAL with compaction on and off, and
 * the compacted plan folds column clauses into CREATE TABLE (asserted as
 * action-shape budgets, never SQL bytes).
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
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
});
