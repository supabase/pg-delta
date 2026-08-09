/**
 * CREATE TYPE … AS RANGE must reproduce SUBTYPE_OPCLASS and
 * MULTIRANGE_TYPE_NAME, not just SUBTYPE/COLLATION/SUBTYPE_DIFF (PR #299
 * review, supabase/pg-toolbelt). Before this, a range type that pinned a
 * non-default subtype operator class or a custom multirange type name was
 * recreated without those options. Pure rule/diff level — no DB. Range types
 * are drop+create, so each option must render in the CREATE.
 *
 * CANONICAL is intentionally deferred: its function takes the range type as an
 * argument, so it needs a shell-type-first ordering, and a canonical function
 * can only be written in C — unreachable from pure user-schema SQL DDL.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};
const rangeId: StableId = { kind: "type", schema: "app", name: "r" };
const rangeFact = (extra: Record<string, unknown>): Fact => ({
  id: rangeId,
  parent: { kind: "schema", name: "app" },
  payload: {
    variant: "range",
    subtype: "integer",
    collation: null,
    subtypeDiff: null,
    subtypeOpclass: null,
    multirangeTypeName: null,
    ...extra,
  },
});
const base = (extra: Fact[]) => buildFactBase([schemaFact, ...extra], []);

describe("range type option rendering", () => {
  const create = (extra: Record<string, unknown>): string =>
    plan(base([]), base([rangeFact(extra)]))
      .actions.map((a) => a.sql)
      .join("\n");

  test("renders SUBTYPE_OPCLASS", () => {
    expect(create({ subtypeOpclass: "pg_catalog.int4_ops" })).toContain(
      "SUBTYPE_OPCLASS = pg_catalog.int4_ops",
    );
  });

  test("renders MULTIRANGE_TYPE_NAME", () => {
    expect(create({ multirangeTypeName: `"app"."r_mr"` })).toContain(
      `MULTIRANGE_TYPE_NAME = "app"."r_mr"`,
    );
  });

  test("a default opclass / auto multirange name render nothing extra", () => {
    const sql = create({});
    expect(sql).not.toContain("SUBTYPE_OPCLASS");
    expect(sql).not.toContain("MULTIRANGE_TYPE_NAME");
  });

  test("an opclass-only change recreates the range type", () => {
    const sql = plan(
      base([rangeFact({ subtypeOpclass: null })]),
      base([rangeFact({ subtypeOpclass: "pg_catalog.int4_ops" })]),
    ).actions.map((a) => a.sql);
    expect(sql.some((s) => s.startsWith("DROP TYPE"))).toBe(true);
    expect(
      sql.some((s) => s.includes("SUBTYPE_OPCLASS = pg_catalog.int4_ops")),
    ).toBe(true);
  });
});
