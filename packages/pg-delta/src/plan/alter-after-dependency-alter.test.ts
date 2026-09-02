/**
 * An in-place ALTER of a dependent must run AFTER the in-place ALTER of what
 * it depends on: adding an enum value and pointing
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
    // added in both directions — that would be an unsortable action graph.
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

  test("a three-domain default ring does not form a cycle", () => {
    const d1: StableId = { kind: "domain", schema: "public", name: "d1" };
    const d2: StableId = { kind: "domain", schema: "public", name: "d2" };
    const d3: StableId = { kind: "domain", schema: "public", name: "d3" };
    const domains = (a: string, b: string, c: string) =>
      buildFactBase(
        [
          { id: schemaId, payload: {} },
          {
            id: d1,
            parent: schemaId,
            payload: { baseType: "integer", notNull: false, default: a },
          },
          {
            id: d2,
            parent: schemaId,
            payload: { baseType: "integer", notNull: false, default: b },
          },
          {
            id: d3,
            parent: schemaId,
            payload: { baseType: "integer", notNull: false, default: c },
          },
        ] satisfies Fact[],
        [
          { from: d1, to: d2, kind: "depends" },
          { from: d2, to: d3, kind: "depends" },
          { from: d3, to: d1, kind: "depends" },
        ],
      );
    const source = domains(
      "(1)::public.d2",
      "(1)::public.d3",
      "(1)::public.d1",
    );
    const desired = domains(
      "(2)::public.d2",
      "(2)::public.d3",
      "(2)::public.d1",
    );
    expect(() => plan(source, desired)).not.toThrow();
    expect(
      plan(source, desired)
        .actions.map((a) => a.sql)
        .toSorted(),
    ).toEqual([
      `ALTER DOMAIN "public"."d1" SET DEFAULT (2)::public.d2`,
      `ALTER DOMAIN "public"."d2" SET DEFAULT (2)::public.d3`,
      `ALTER DOMAIN "public"."d3" SET DEFAULT (2)::public.d1`,
    ]);
  });

  test("SET DEFAULT through an unchanged domain is ordered after ADD VALUE", () => {
    const domainId: StableId = {
      kind: "domain",
      schema: "public",
      name: "dst",
    };
    const throughDomain = (values: string[], defaultValue: string) =>
      buildFactBase(
        [
          { id: schemaId, payload: {} },
          {
            id: typeId,
            parent: schemaId,
            payload: { variant: "enum", values },
          },
          {
            id: domainId,
            parent: schemaId,
            payload: { baseType: "public.st", notNull: false, default: null },
          },
          { id: tableId, parent: schemaId, payload: { persistence: "p" } },
          {
            id: columnId,
            parent: tableId,
            payload: { type: "public.dst", notNull: false },
          },
          {
            id: defaultId,
            parent: columnId,
            payload: { expr: `'${defaultValue}'::public.dst` },
          },
        ] satisfies Fact[],
        [
          { from: columnId, to: domainId, kind: "depends" },
          { from: defaultId, to: domainId, kind: "depends" },
          { from: domainId, to: typeId, kind: "depends" },
        ],
      );
    const source = throughDomain(["a", "b"], "a");
    const desired = throughDomain(["a", "b", "c"], "c");
    const sql = plan(source, desired).actions.map((a) => a.sql);
    const addValue = sql.findIndex((s) => s.includes("ADD VALUE 'c'"));
    const setDefault = sql.findIndex((s) => s.includes("SET DEFAULT 'c'"));
    expect(addValue).toBeGreaterThanOrEqual(0);
    expect(setDefault).toBeGreaterThanOrEqual(0);
    expect(addValue).toBeLessThan(setDefault);
  });

  test("OWNED BY a new column of a domain whose default uses the sequence stays sortable", () => {
    const domainId: StableId = { kind: "domain", schema: "public", name: "d" };
    const seqId: StableId = { kind: "sequence", schema: "public", name: "q" };
    const newCol: StableId = {
      kind: "column",
      schema: "public",
      table: "t",
      name: "c",
    };
    const seqPayload = (
      ownedBy: { schema: string; table: string; column: string } | null,
    ) => ({
      dataType: "bigint",
      increment: "1",
      minValue: "1",
      maxValue: "9223372036854775807",
      start: "1",
      cache: "1",
      cycle: false,
      ownedBy,
    });
    const source = buildFactBase(
      [
        { id: schemaId, payload: {} },
        { id: tableId, parent: schemaId, payload: { persistence: "p" } },
        {
          id: domainId,
          parent: schemaId,
          payload: { baseType: "bigint", notNull: false, default: "1" },
        },
        { id: seqId, parent: schemaId, payload: seqPayload(null) },
      ] satisfies Fact[],
      [],
    );
    const desired = buildFactBase(
      [
        { id: schemaId, payload: {} },
        { id: tableId, parent: schemaId, payload: { persistence: "p" } },
        {
          id: domainId,
          parent: schemaId,
          payload: {
            baseType: "bigint",
            notNull: false,
            default: `nextval('public.q'::regclass)`,
          },
        },
        {
          id: seqId,
          parent: schemaId,
          payload: seqPayload({
            schema: "public",
            table: "t",
            column: "c",
          }),
        },
        {
          id: newCol,
          parent: tableId,
          payload: { type: "public.d", notNull: false },
        },
      ] satisfies Fact[],
      [
        { from: domainId, to: seqId, kind: "depends" },
        { from: newCol, to: domainId, kind: "depends" },
      ],
    );
    expect(() => plan(source, desired)).not.toThrow();
    expect(plan(source, desired).actions.map((a) => a.sql)).toEqual([
      `ALTER DOMAIN "public"."d" SET DEFAULT nextval('public.q'::regclass)`,
      `ALTER TABLE "public"."t" ADD COLUMN "c" public.d`,
      `ALTER SEQUENCE "public"."q" OWNED BY "public"."t"."c"`,
    ]);
  });
});
