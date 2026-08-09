/**
 * Table column ORDER is desired state (row layout): a from-empty `CREATE TABLE`
 * must render its columns in declared positional order, not the encoded-id
 * (name) order that drives the default action tie-break. Before the fix a table
 * declared `(z int, b int, a int)` reconstructed as `(a, b, z)` — a silent
 * column reorder that changes `SELECT *`, positional INSERTs, and the row-type
 * layout, and is invisible to the hash (so the proof can't see it).
 *
 * Two facets, both pinned here (pure rule/diff level — no DB):
 *   1. the from-empty CREATE renders columns in declared `_position` order;
 *   2. `_position` is NON-semantic — two fact bases identical except column
 *      declaration ORDER hash-equal, so an order-only reshuffle on an EXISTING
 *      table stays undiffable BY DESIGN (mirrors the composite `_position` field).
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "s" },
  payload: { owner: "test" },
};
const tableId: StableId = { kind: "table", schema: "s", name: "t" };
const tableFact: Fact = {
  id: tableId,
  parent: { kind: "schema", name: "s" },
  payload: {
    persistence: "p",
    rowSecurity: false,
    forceRowSecurity: false,
    replicaIdentity: "d",
    replicaIdentityIndex: null,
    partitionKey: null,
    partitionBound: null,
    parentTable: null,
    reloptions: null,
  },
};
const columnFact = (name: string, type: string, position: number): Fact => ({
  id: { kind: "column", schema: "s", table: "t", name },
  parent: tableId,
  payload: {
    _position: position,
    type,
    notNull: false,
    identity: null,
    collation: null,
    generatedExpr: null,
  },
});

describe("table column order", () => {
  test("from-empty CREATE TABLE renders columns in declared position order", () => {
    // declared order is NOT alphabetical: z(1) < b(2) < a(3). Alphabetical would
    // put a first.
    const facts: Fact[] = [
      schemaFact,
      tableFact,
      columnFact("z", "integer", 1),
      columnFact("b", "integer", 2),
      columnFact("a", "integer", 3),
    ];
    const sql = plan(buildFactBase([], []), buildFactBase(facts, []))
      .actions.map((a) => a.sql)
      .find((s) => s.startsWith(`CREATE TABLE "s"."t"`));
    expect(sql).toMatchInlineSnapshot(
      `"CREATE TABLE "s"."t" ("z" integer, "b" integer, "a" integer)"`,
    );
  });

  test("_position is non-semantic: order-only differences hash-equal", () => {
    const ascending = buildFactBase(
      [
        schemaFact,
        tableFact,
        columnFact("a", "integer", 1),
        columnFact("b", "integer", 2),
      ],
      [],
    );
    const swapped = buildFactBase(
      [
        schemaFact,
        tableFact,
        columnFact("a", "integer", 2),
        columnFact("b", "integer", 1),
      ],
      [],
    );
    // identical except the declared column ORDER → equal root hash (the field is
    // `_`-prefixed, so it never enters the canonical hash or the diff).
    expect(swapped.rootHash).toBe(ascending.rootHash);
  });
});
