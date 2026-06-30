/**
 * Shadowed dependency edges for column defaults (PR #307 review #3500428568).
 *
 * pg records a column's `pg_attrdef` dependencies under a `default` id. An
 * ORDINARY default is its own fact (which carries the dep and is alsoProduced by
 * the column CREATE), so the column needs NO shadow edge — adding one would make
 * buildActionGraph reject a still-valid plan when a policy filters the default.
 * A GENERATED column has NO default fact, so the dep is shadowed onto the column
 * (the only carrier) to drive ordering.
 *
 * Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { encodeId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("column default shadow edges", () => {
  test("ordinary default: dep on the `default` fact, NOT a column shadow", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("gencol_ordinary");
    dbs.push(db);
    await db.pool.query(`
      CREATE SCHEMA app;
      CREATE SEQUENCE app.s;
      CREATE TABLE app.t (id integer DEFAULT nextval('app.s'));
    `);
    const { factBase } = await extract(db.pool);
    const seq = encodeId({ kind: "sequence", schema: "app", name: "s" });
    const col = encodeId({
      kind: "column",
      schema: "app",
      table: "t",
      name: "id",
    });
    const dep = encodeId({
      kind: "default",
      schema: "app",
      table: "t",
      name: "id",
    });
    const edgeKeys = factBase.edges.map(
      (e) => `${encodeId(e.from)} -> ${encodeId(e.to)}`,
    );
    // the default fact carries the dep …
    expect(edgeKeys).toContain(`${dep} -> ${seq}`);
    // … and the column does NOT also shadow it
    expect(edgeKeys).not.toContain(`${col} -> ${seq}`);
  });

  test("generated column: dep is shadowed onto the column (no default fact)", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("gencol_generated");
    dbs.push(db);
    await db.pool.query(`
      CREATE SCHEMA app;
      CREATE TABLE app.t (
        a integer,
        g integer GENERATED ALWAYS AS (a + 1) STORED
      );
    `);
    const { factBase } = await extract(db.pool);
    const colG = encodeId({
      kind: "column",
      schema: "app",
      table: "t",
      name: "g",
    });
    const colA = encodeId({
      kind: "column",
      schema: "app",
      table: "t",
      name: "a",
    });
    const edgeKeys = factBase.edges.map(
      (e) => `${encodeId(e.from)} -> ${encodeId(e.to)}`,
    );
    // no `default` fact for a generated column …
    expect(factBase.facts().some((f) => f.id.kind === "default")).toBe(false);
    // … so the base-column dep is shadowed onto the generated column
    expect(edgeKeys).toContain(`${colG} -> ${colA}`);
  });
});
