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
  }
});
