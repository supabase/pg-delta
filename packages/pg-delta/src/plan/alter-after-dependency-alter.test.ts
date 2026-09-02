/**
 * An in-place ALTER of a dependent must run AFTER the in-place ALTER of what
 * it depends on (Slack report, 2026-09-02): adding an enum value and pointing
 * an EXISTING column's default at that value in the same plan emitted
 *
 *   ALTER TABLE … ALTER COLUMN … SET DEFAULT 'c'::st;   -- 22P02: invalid input
 *   ALTER TYPE … ADD VALUE 'c';
 *
 * The produces walk already orders a CREATE after in-place alterers of its
 * dependencies (a NEW column with the new value as default works), but an
 * alter action produces nothing, so the alter-vs-alter pair fell through to
 * the weight tie-break (default 6 < type 7). No Docker — synthetic fact bases.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaId: StableId = { kind: "schema", name: "public" };
const typeId: StableId = { kind: "type", schema: "public", name: "st" };
const tableId: StableId = { kind: "table", schema: "public", name: "t" };
const columnId: StableId = {
  kind: "column",
  schema: "public",
  table: "t",
  name: "s",
};
const defaultId: StableId = {
  kind: "default",
  schema: "public",
  table: "t",
  name: "s",
};

const state = (values: string[], defaultValue: string) =>
  buildFactBase(
    [
      { id: schemaId, payload: {} },
      {
        id: typeId,
        parent: schemaId,
        payload: { variant: "enum", values },
      },
      { id: tableId, parent: schemaId, payload: { persistence: "p" } },
      {
        id: columnId,
        parent: tableId,
        payload: { type: "public.st", notNull: false },
      },
      {
        id: defaultId,
        parent: columnId,
        payload: { expr: `'${defaultValue}'::public.st` },
      },
    ] satisfies Fact[],
    [
      { from: columnId, to: typeId, kind: "depends" },
      // pg_depend: the attrdef's Const of type st references pg_type st
      { from: defaultId, to: typeId, kind: "depends" },
    ],
  );

describe("plan() — in-place alter of a dependent follows its dependency's alter", () => {
  test("SET DEFAULT to a new enum value is ordered after ADD VALUE", () => {
    const source = state(["a", "b"], "a");
    const desired = state(["a", "b", "c"], "c");
    const sql = plan(source, desired).actions.map((a) => a.sql);
    const addValue = sql.findIndex((s) => s.includes("ADD VALUE 'c'"));
    const setDefault = sql.findIndex((s) => s.includes("SET DEFAULT 'c'"));
    expect(addValue).toBeGreaterThanOrEqual(0);
    expect(setDefault).toBeGreaterThanOrEqual(0);
    expect(sql).toMatchInlineSnapshot(`
      [
        "ALTER TYPE "public"."st" ADD VALUE 'c' AFTER 'b'",
        "ALTER TABLE "public"."t" ALTER COLUMN "s" SET DEFAULT 'c'::public.st",
      ]
    `);
    expect(addValue).toBeLessThan(setDefault);
  });

  test("reciprocal dependencies between two altered facts do not form a cycle", () => {
    // Two domains whose DEFAULT expressions reference each other (possible via
    // ALTER DOMAIN … SET DEFAULT once both exist), both defaults changing in
    // one plan. Neither order is derivable from the fact graph and either
    // works at apply (both types exist throughout), so the edge must not be
    // added in both directions — that would be an unsortable action graph
    // where the previous behavior emitted both alters (Codex P2, PR #455).
    const d1: StableId = { kind: "domain", schema: "public", name: "d1" };
    const d2: StableId = { kind: "domain", schema: "public", name: "d2" };
    const domains = (def1: string, def2: string) =>
      buildFactBase(
        [
          { id: schemaId, payload: {} },
          {
            id: d1,
            parent: schemaId,
            payload: { baseType: "integer", notNull: false, default: def1 },
          },
          {
            id: d2,
            parent: schemaId,
            payload: { baseType: "integer", notNull: false, default: def2 },
          },
        ] satisfies Fact[],
        [
          { from: d1, to: d2, kind: "depends" },
          { from: d2, to: d1, kind: "depends" },
        ],
      );
    const source = domains("(1)::public.d2", "(1)::public.d1");
    const desired = domains("(2)::public.d2", "(2)::public.d1");
    const sql = plan(source, desired).actions.map((a) => a.sql);
    expect(sql).toMatchInlineSnapshot(`
      [
        "ALTER DOMAIN "public"."d1" SET DEFAULT (2)::public.d2",
        "ALTER DOMAIN "public"."d2" SET DEFAULT (2)::public.d1",
      ]
    `);
  });
});
