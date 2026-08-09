/**
 * Composite type attribute ORDER is desired state (row layout): a composite
 * `CREATE TYPE … AS (…)` must render its attributes in declared positional
 * order, not the encoded-id (name) order that `childrenOf` yields. Before the
 * fix the attribute facts were rendered alphabetically, so a type declared
 * `(wal, is_rls_enabled, subscription_ids, errors)` reconstructed as
 * `(errors, is_rls_enabled, subscription_ids, wal)` — a silent column reorder
 * that breaks composite-returning dependents. Pure rule/diff level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "realtime" },
  payload: { owner: "test" },
};
const typeFact: Fact = {
  id: { kind: "type", schema: "realtime", name: "wal_rls" },
  parent: { kind: "schema", name: "realtime" },
  payload: { variant: "composite" },
};
const typeId: StableId = { kind: "type", schema: "realtime", name: "wal_rls" };
const attrFact = (name: string, type: string, position: number): Fact => ({
  id: { kind: "typeAttribute", schema: "realtime", type: "wal_rls", name },
  parent: typeId,
  payload: { type, collation: null, _position: position },
});

describe("composite attribute order", () => {
  test("CREATE TYPE renders attributes in declared position order", () => {
    // declared order is NOT alphabetical: wal(1) < is_rls_enabled(2) <
    // subscription_ids(3) < errors(4). Alphabetical would put errors first.
    const facts: Fact[] = [
      schemaFact,
      typeFact,
      attrFact("wal", "jsonb", 1),
      attrFact("is_rls_enabled", "boolean", 2),
      attrFact("subscription_ids", "uuid[]", 3),
      attrFact("errors", "text[]", 4),
    ];
    const sql = plan(buildFactBase([], []), buildFactBase(facts, []))
      .actions.map((a) => a.sql)
      .find((s) => s.startsWith(`CREATE TYPE "realtime"."wal_rls"`));
    expect(sql).toMatchInlineSnapshot(
      `"CREATE TYPE "realtime"."wal_rls" AS ("wal" jsonb, "is_rls_enabled" boolean, "subscription_ids" uuid[], "errors" text[])"`,
    );
  });
});
