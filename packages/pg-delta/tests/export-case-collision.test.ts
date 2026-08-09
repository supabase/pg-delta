/**
 * Case-twin objects (`"Users"` vs `"users"`) must survive a declarative export
 * (issue #365): PostgreSQL identifiers are case-sensitive but APFS/NTFS are
 * not, so two export paths differing only by case are ONE physical file there
 * and the second write silently destroys the first object. The exporter folds
 * each colliding set into one SHARED file — the lexicographically-smallest
 * member path holds every twin's DDL — on every platform; exports are
 * portable artifacts, written on Linux, checked out on a Mac.
 *
 * This gates, for every layout: (1) the emitted paths are case-insensitively
 * unique, so the export cannot be corrupted by a case-insensitive disk; and
 * (2) the merged files still round-trip — `load(export(fb)) ≡ fb`.
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

// Case twins across object kinds: tables (with an FK between the twins, so a
// dependent wedges if one twin vanishes), a view twin over a table name, and
// function twins.
const CASE_TWIN_SQL = `
  CREATE TABLE "Users" (id integer PRIMARY KEY);
  CREATE TABLE "users" (id integer PRIMARY KEY, "User_id" integer REFERENCES "Users" (id));
  CREATE VIEW "USERS" AS SELECT id FROM "users";
  CREATE FUNCTION "Get_user"() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1';
  CREATE FUNCTION "get_user"() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 2';
`;

function forLoad(files: { name: string; sql: string }[]) {
  // cluster-global roles already exist in the shared cluster (same filter as
  // export-fidelity.test.ts).
  return files.filter((f) => !/cluster[_/]roles/.test(f.name));
}

// An FK chain that is ACYCLIC at table grain becomes a real cycle at FILE
// grain once case twins merge: "Foo" → helper → "foo" with Foo/foo sharing a
// file means the merged file waits for helper while helper waits for the
// merged file — the raw file-atomic loader would exhaust its retry rounds
// (PR #368 review). The cycle analysis must treat tables that will share a
// file as one node, so these FKs take the .fk.sql split and the load
// converges.
const TWIN_FK_CHAIN_SQL = `
  CREATE TABLE "foo" (id integer PRIMARY KEY);
  CREATE TABLE helper (id integer PRIMARY KEY,
    f integer REFERENCES "foo" (id));
  CREATE TABLE "Foo" (id integer PRIMARY KEY,
    h integer REFERENCES helper (id));
`;

describe("export: FK chain through case twins stays loadable", () => {
  for (const layout of ["by-object", "grouped"] as const) {
    test(`merged twins + interposed FK round-trip (${layout})`, async () => {
      const cluster = await sharedCluster();
      const src = await cluster.createDb(
        `twin_fk_src_${layout.replace("-", "_")}`,
      );
      const shadow = await cluster.createDb(
        `twin_fk_shadow_${layout.replace("-", "_")}`,
      );
      try {
        await src.pool.query(TWIN_FK_CHAIN_SQL);
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

// MUTUAL FKs directly between the case twins (PR #368 review): folding both
// table keys to one node must not erase the twins' mutual reference as a
// self-edge — the merged file contains both CREATEs, and an inline FK to the
// other twin references a table the same file has not created yet, so the
// file can never apply. Both FKs must take the .fk.sql split (as they did
// for distinctly-named mutual FK tables all along).
const MUTUAL_TWIN_FK_SQL = `
  CREATE TABLE "Foo" (id integer PRIMARY KEY, other integer);
  CREATE TABLE "foo" (id integer PRIMARY KEY,
    other integer REFERENCES "Foo" (id));
  ALTER TABLE "Foo"
    ADD CONSTRAINT foo_other_fk FOREIGN KEY (other) REFERENCES "foo" (id);
`;

describe("export: mutual FKs between case twins stay loadable", () => {
  for (const layout of ["by-object", "grouped"] as const) {
    test(`mutual twin FKs round-trip (${layout})`, async () => {
      const cluster = await sharedCluster();
      const src = await cluster.createDb(
        `mutual_twin_src_${layout.replace("-", "_")}`,
      );
      const shadow = await cluster.createDb(
        `mutual_twin_shadow_${layout.replace("-", "_")}`,
      );
      try {
        await src.pool.query(MUTUAL_TWIN_FK_SQL);
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

// The same file-grain cycle with NON-FK dependencies (PR #368 review): view
// "Foo" selects helper, helper selects case-twin view "foo". There is no
// deferrable ALTER to split out of a CREATE VIEW, so the only way the raw
// file-atomic loader can converge is merging the whole dependency cycle —
// twins AND the interposed helper — into one file, in plan order.
const TWIN_VIEW_CHAIN_SQL = `
  CREATE VIEW "foo" AS SELECT 1 AS x;
  CREATE VIEW helper AS SELECT x FROM "foo";
  CREATE VIEW "Foo" AS SELECT x FROM helper;
`;

describe("export: non-FK dependency chain through case twins stays loadable", () => {
  for (const layout of ["by-object", "grouped"] as const) {
    test(`merged twin views + interposed view round-trip (${layout})`, async () => {
      const cluster = await sharedCluster();
      const src = await cluster.createDb(
        `twin_view_src_${layout.replace("-", "_")}`,
      );
      const shadow = await cluster.createDb(
        `twin_view_shadow_${layout.replace("-", "_")}`,
      );
      try {
        await src.pool.query(TWIN_VIEW_CHAIN_SQL);
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

describe("export: case-twin objects survive case-insensitive filesystems", () => {
  for (const layout of LAYOUTS) {
    test(`paths are case-insensitively unique and round-trip (${layout})`, async () => {
      const cluster = await sharedCluster();
      const src = await cluster.createDb(
        `case_twin_src_${layout.replace("-", "_")}`,
      );
      const shadow = await cluster.createDb(
        `case_twin_shadow_${layout.replace("-", "_")}`,
      );
      try {
        await src.pool.query(CASE_TWIN_SQL);
        const fb = (await extract(src.pool)).factBase;

        const files = forLoad(exportSqlFiles(fb, { layout }));

        // (1) no two paths may be one physical file on APFS/NTFS
        const folded = files.map((f) => f.name.toLowerCase());
        expect(new Set(folded).size).toBe(files.length);

        // the table twins share ONE file at the canonical member path (the
        // ordered layout instead keeps them apart via its sequence prefix)
        if (layout !== "ordered") {
          const merged = files.find(
            (f) => f.name === "schemas/public/tables/Users.sql",
          );
          expect(merged?.sql).toContain(`"Users"`);
          expect(merged?.sql).toContain(`"users"`);
        }

        // no object silently lost from the emitted SQL
        const all = files.map((f) => f.sql).join("\n");
        expect(all).toContain(`"Users"`);
        expect(all).toContain(`"USERS"`);
        expect(all).toContain(`"Get_user"`);
        expect(all).toContain(`"get_user"`);

        // (2) the renamed files still reload to the identical fact base
        const loaded = await loadSqlFiles(files, shadow.pool);
        expect(loaded.factBase.rootHash).toBe(fb.rootHash);
      } finally {
        await Promise.all([src.drop(), shadow.drop()]);
      }
    }, 120_000);
  }
});
