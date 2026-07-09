/**
 * Declarative-export ROUND-TRIP FIDELITY across all three layouts.
 *
 * The contract `load(export(fb)) ≡ fb` must hold for `by-object`, `ordered`,
 * AND `grouped` — export is only trustworthy as a source of truth if every
 * advertised layout reloads to the identical fact base. `export-format.test.ts`
 * already gates the formatter on a simple schema; this file gates two shapes
 * surfaced while dogfooding a real DB:
 *
 *  1. **Cross-schema mutual FKs** (the bug this stage fixes) — before the FK
 *     split, `by-object`/`grouped` filed each table's `ALTER TABLE … ADD
 *     CONSTRAINT FOREIGN KEY` into the table's own file, so two tables with
 *     mutual FKs landed in two files that each failed atomically (each
 *     references a table the other file creates) → the loader got stuck.
 *     Routing FK constraints into a sibling `<table>.fk.sql` fixes it.
 *  2. **ALTER DEFAULT PRIVILEGES order-independence** (a pin, not a fix) — a
 *     table created BEFORE an ADP change has a different ACL than one created
 *     after. This round-trips regardless of the order the reload replays the ADP
 *     statement, because the exporter emits EXPLICIT per-object REVOKE/GRANT for
 *     every object (an already-enforced invariant: `plan/internal.ts` keeps
 *     those groups load-bearing whenever an ADP customizes an objtype). This
 *     case guards that invariant against regression across all three layouts.
 *
 * Uses PUBLIC (a pseudo-role always present, never emitted as CREATE ROLE) for
 * the ADP grant so the fixture needs no cluster-scoped role and the reload can
 * run in a fresh database of the shared cluster (like export-format.test.ts,
 * cluster/roles* files are filtered out).
 *
 * Docker required.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import {
  exportSqlFiles,
  type ExportOptions,
} from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { sharedCluster } from "./containers.ts";

const LAYOUTS: NonNullable<ExportOptions["layout"]>[] = [
  "by-object",
  "ordered",
  "grouped",
];

// Two schemas, a mutual FK across them, and a comment on one FK constraint.
const MUTUAL_FK_SQL = `
  CREATE SCHEMA a;
  CREATE SCHEMA b;
  CREATE TABLE a.orders (id integer PRIMARY KEY, customer_id integer);
  CREATE TABLE b.customers (id integer PRIMARY KEY, last_order_id integer);
  ALTER TABLE a.orders
    ADD CONSTRAINT fk_cust FOREIGN KEY (customer_id) REFERENCES b.customers (id);
  ALTER TABLE b.customers
    ADD CONSTRAINT fk_order FOREIGN KEY (last_order_id) REFERENCES a.orders (id);
  COMMENT ON CONSTRAINT fk_cust ON a.orders IS 'links to customer';
`;

// t1 is created BEFORE the ADP change, t2 AFTER — so t2 carries an explicit
// SELECT-to-PUBLIC ACL and t1 does not. Replaying the ADP first would wrongly
// grant t1 too.
const ADP_ASYMMETRY_SQL = `
  CREATE SCHEMA c;
  CREATE TABLE c.t1 (id integer);
  ALTER DEFAULT PRIVILEGES IN SCHEMA c GRANT SELECT ON TABLES TO PUBLIC;
  CREATE TABLE c.t2 (id integer);
`;

// ADP order-independence must hold across OBJTYPES, not just tables, and in the
// restrictive direction (REVOKE of a built-in default). Sequences: s1 (pre-ADP)
// has no PUBLIC usage, s2 (post-ADP) does — an additive grant. Functions:
// EXECUTE is granted to PUBLIC by DEFAULT, so f1 (pre-ADP) keeps it and f2
// (post-ADP) has it revoked — the restrictive direction that exercises the
// empty-PUBLIC-entry synthesis in the ACL extractor. Both must round-trip on
// every layout with no code change (the explicit per-object grants the exporter
// emits are load-bearing regardless of when the ADP statement replays).
const ADP_OBJTYPES_SQL = `
  CREATE SCHEMA d;
  CREATE SEQUENCE d.s1;
  ALTER DEFAULT PRIVILEGES IN SCHEMA d GRANT USAGE ON SEQUENCES TO PUBLIC;
  CREATE SEQUENCE d.s2;
  CREATE FUNCTION d.f1() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1';
  ALTER DEFAULT PRIVILEGES IN SCHEMA d REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  CREATE FUNCTION d.f2() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 2';
`;

// Regression pin for the scratchpad handoff's "Finding 4" (suspected extractor
// gaps, unconfirmed while the load never completed): table autovacuum reloptions
// and non-owner function GRANTs. Now that export round-trips, confirm they are
// captured, rendered, AND reload identically. `pg_read_all_data` is a built-in
// predefined role present on every PG14+ cluster (never emitted as CREATE ROLE),
// so the non-owner grant needs no fixture role and pollutes no shared cluster.
const RELOPTIONS_AND_GRANTS_SQL = `
  CREATE SCHEMA e;
  CREATE TABLE e.t (id integer)
    WITH (autovacuum_vacuum_scale_factor = 0.2, fillfactor = 70);
  CREATE FUNCTION e.f() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1';
  REVOKE ALL ON FUNCTION e.f() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION e.f() TO pg_read_all_data;
`;

function forLoad(files: { name: string; sql: string }[]) {
  // roles are cluster-global and already present in the shared cluster; drop
  // the CREATE ROLE file exactly as export-format.test.ts does. The `ordered`
  // layout prefixes a sequence number (`0000_cluster_roles.sql`), so match the
  // roles file across every layout's naming.
  return files.filter((f) => !/cluster[_/]roles/.test(f.name));
}

describe("export: round-trip fidelity (all layouts)", () => {
  for (const layout of LAYOUTS) {
    test(`cross-schema mutual FKs round-trip (${layout})`, async () => {
      const cluster = await sharedCluster();
      const src = await cluster.createDb(`fid_fk_src_${layout}`);
      const shadow = await cluster.createDb(`fid_fk_shadow_${layout}`);
      try {
        await src.pool.query(MUTUAL_FK_SQL);
        const fb = (await extract(src.pool)).factBase;

        const files = forLoad(exportSqlFiles(fb, { layout }));
        const loaded = await loadSqlFiles(files, shadow.pool);
        expect(loaded.factBase.rootHash).toBe(fb.rootHash);
      } finally {
        await Promise.all([src.drop(), shadow.drop()]);
      }
    }, 120_000);

    test(`ALTER DEFAULT PRIVILEGES applied last preserves per-table ACLs (${layout})`, async () => {
      const cluster = await sharedCluster();
      const src = await cluster.createDb(`fid_adp_src_${layout}`);
      const shadow = await cluster.createDb(`fid_adp_shadow_${layout}`);
      try {
        await src.pool.query(ADP_ASYMMETRY_SQL);
        const fb = (await extract(src.pool)).factBase;

        const files = forLoad(exportSqlFiles(fb, { layout }));
        const loaded = await loadSqlFiles(files, shadow.pool);
        expect(loaded.factBase.rootHash).toBe(fb.rootHash);
      } finally {
        await Promise.all([src.drop(), shadow.drop()]);
      }
    }, 120_000);

    test(`ADP order-independence holds for sequences + functions, incl. the restrictive REVOKE (${layout})`, async () => {
      const cluster = await sharedCluster();
      const src = await cluster.createDb(`fid_adpobj_src_${layout}`);
      const shadow = await cluster.createDb(`fid_adpobj_shadow_${layout}`);
      try {
        await src.pool.query(ADP_OBJTYPES_SQL);
        const fb = (await extract(src.pool)).factBase;

        const files = forLoad(exportSqlFiles(fb, { layout }));
        const loaded = await loadSqlFiles(files, shadow.pool);
        expect(loaded.factBase.rootHash).toBe(fb.rootHash);
      } finally {
        await Promise.all([src.drop(), shadow.drop()]);
      }
    }, 120_000);

    test(`autovacuum reloptions + non-owner function grants round-trip (${layout})`, async () => {
      const cluster = await sharedCluster();
      const src = await cluster.createDb(`fid_relopt_src_${layout}`);
      const shadow = await cluster.createDb(`fid_relopt_shadow_${layout}`);
      try {
        await src.pool.query(RELOPTIONS_AND_GRANTS_SQL);
        const fb = (await extract(src.pool)).factBase;

        const files = forLoad(exportSqlFiles(fb, { layout }));
        // both must actually appear in the export (not just round-trip to a
        // matching-but-empty state)
        const all = files.map((f) => f.sql).join("\n");
        expect(all).toMatch(/autovacuum_vacuum_scale_factor/);
        expect(all).toMatch(/GRANT EXECUTE[\s\S]*pg_read_all_data/);

        const loaded = await loadSqlFiles(files, shadow.pool);
        expect(loaded.factBase.rootHash).toBe(fb.rootHash);
      } finally {
        await Promise.all([src.drop(), shadow.drop()]);
      }
    }, 120_000);
  }

  // grouped layout with `--flat-schemas` must STILL split FKs into `.fk.sql`:
  // flat regrouping collapses a schema to one file per category, which would
  // otherwise fold cross-schema mutual FKs back together and re-stick the load.
  test("grouped + flat-schemas keeps the FK split for cross-schema mutual FKs", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("fid_flatfk_src");
    const shadow = await cluster.createDb("fid_flatfk_shadow");
    try {
      await src.pool.query(MUTUAL_FK_SQL);
      const fb = (await extract(src.pool)).factBase;
      const files = forLoad(
        exportSqlFiles(fb, {
          layout: "grouped",
          grouping: { flatSchemas: ["a", "b"] },
        }),
      );
      const loaded = await loadSqlFiles(files, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);

  // Export-only constraint folding: validated table constraints render INLINE
  // inside their CREATE TABLE parens (`CONSTRAINT name <def>`), like
  // hand-written SQL — instead of a trail of ALTER TABLE ADD CONSTRAINT.
  // NOT VALID constraints cannot inline (inline constraints always validate)
  // and stay as ALTERs; cyclic FKs keep the .fk.sql split (covered above).
  test("validated constraints fold inline into CREATE TABLE; NOT VALID stays an ALTER", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("fid_fold_src");
    const shadow = await cluster.createDb("fid_fold_shadow");
    try {
      await src.pool.query(`
        CREATE SCHEMA f;
        CREATE TABLE f.customers (id integer PRIMARY KEY);
        CREATE TABLE f.orders (
          id integer,
          customer_id integer,
          qty integer,
          email text,
          CONSTRAINT orders_pk PRIMARY KEY (id),
          CONSTRAINT orders_qty_ck CHECK (qty > 0),
          CONSTRAINT orders_email_uq UNIQUE (email),
          CONSTRAINT orders_cust_fk FOREIGN KEY (customer_id)
            REFERENCES f.customers (id)
        );
        ALTER TABLE f.orders
          ADD CONSTRAINT orders_qty_big CHECK (qty < 1000) NOT VALID;
      `);
      const fb = (await extract(src.pool)).factBase;
      const files = forLoad(exportSqlFiles(fb));
      const orders = files.find(
        (f) => f.name === "schemas/f/tables/orders.sql",
      )?.sql;
      expect(orders).toBeDefined();
      // all four validated constraints inline, names preserved
      expect(orders).toContain(`CONSTRAINT "orders_pk" PRIMARY KEY`);
      expect(orders).toContain(`CONSTRAINT "orders_qty_ck" CHECK`);
      expect(orders).toContain(`CONSTRAINT "orders_email_uq" UNIQUE`);
      expect(orders).toContain(`CONSTRAINT "orders_cust_fk" FOREIGN KEY`);
      // the ONLY remaining ADD CONSTRAINT is the NOT VALID one
      const addConstraints = orders!.match(/ADD CONSTRAINT/g) ?? [];
      expect(addConstraints).toHaveLength(1);
      expect(orders).toContain("NOT VALID");

      const loaded = await loadSqlFiles(files, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);

  // Satellite-on-extension-member routing must survive grouped/flat regrouping
  // (like the .fk.sql guard) AND round-trip: an ACL on a pgcrypto member files
  // into cluster/extensions/pgcrypto.sql, never back into schemas/public/….
  test("member ACLs route to the extension file and round-trip (grouped + flat)", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("fid_membacl_src");
    const shadow = await cluster.createDb("fid_membacl_shadow");
    try {
      await src.pool.query(`
        CREATE EXTENSION pgcrypto;
        REVOKE ALL ON FUNCTION public.gen_salt(text) FROM PUBLIC;
      `);
      const fb = (await extract(src.pool)).factBase;
      const files = forLoad(
        exportSqlFiles(fb, {
          layout: "grouped",
          grouping: { flatSchemas: ["public"] },
        }),
      );
      const extFile = files.find(
        (f) => f.name === "cluster/extensions/pgcrypto.sql",
      );
      expect(extFile?.sql).toContain("gen_salt");
      // no member ACL leaks back into a public functions file (the public
      // schema's OWN schema.sql — its comment/grants — legitimately remains)
      expect(files.some((f) => f.name.includes("functions"))).toBe(false);
      expect(files.some((f) => f.sql.includes("gen_salt"))).toBe(true);
      const loaded = await loadSqlFiles(files, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);

  // ADP `FOR ROLE` and `WITH GRANT OPTION` rendering fidelity (Fable checklist
  // items 3 + 5). These need a named (non-PUBLIC) role, so the fixture creates
  // one; it is cluster-global and dropped in `finally`. by-object layout only —
  // this pins ACL/ADP RENDERING, and layout-independence is already covered by
  // the cases above. RED risk is a mangled `FOR ROLE` / `WITH GRANT OPTION`
  // clause that fails to reload; GREEN = hash-identical round-trip.
  test("ADP FOR ROLE + WITH GRANT OPTION round-trip", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("fid_adprole_src");
    const shadow = await cluster.createDb("fid_adprole_shadow");
    try {
      await src.pool.query(`
        CREATE ROLE fidrole NOLOGIN;
        CREATE SCHEMA h;
        ALTER DEFAULT PRIVILEGES IN SCHEMA h
          GRANT SELECT ON TABLES TO fidrole WITH GRANT OPTION;
        CREATE TABLE h.t (id integer);
        ALTER DEFAULT PRIVILEGES FOR ROLE fidrole IN SCHEMA h
          GRANT INSERT ON TABLES TO PUBLIC;
      `);
      const fb = (await extract(src.pool)).factBase;
      const files = forLoad(exportSqlFiles(fb));
      const loaded = await loadSqlFiles(files, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await cluster.adminPool
        .query(`DROP OWNED BY fidrole CASCADE`)
        .catch(() => {});
      await cluster.adminPool
        .query(`DROP ROLE IF EXISTS fidrole`)
        .catch(() => {});
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);
});
