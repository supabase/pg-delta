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
    expect(sql).toMatchInlineSnapshot();
    expect(addValue).toBeLessThan(setDefault);
  });
});
