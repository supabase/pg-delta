/**
 * Missing-requirement invariant for DEPENDENCY edges (review P0-1).
 *
 * The planner's missing-requirement guard (internal.ts) covered `consumes`
 * edges but NOT the build-order edges derived from a produced fact's `depends`
 * edges: when a produced fact depends on something neither produced by the plan
 * nor present in source, the produces-loop silently skipped it instead of
 * failing. A policy that filters out the delta creating a dependency (while
 * keeping a dependent) could therefore emit a migration that references a
 * missing object — and the planner would not reject it.
 *
 * No Docker required — synthetic fact bases exercise the planner wiring.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import type { Policy } from "../policy/policy.ts";
import { plan } from "./plan.ts";

const publicSchema: StableId = { kind: "schema", name: "public" };
const hstore: StableId = { kind: "extension", name: "hstore" };
const table: StableId = { kind: "table", schema: "public", name: "t" };
const column: StableId = {
  kind: "column",
  schema: "public",
  table: "t",
  name: "h",
};

const f = (
  id: StableId,
  parent?: StableId,
  payload: Fact["payload"] = {},
): Fact => (parent ? { id, parent, payload } : { id, payload });

describe("plan() — dependency-edge requirement invariant (P0-1)", () => {
  test("a kept fact whose dependency's creation was filtered out fails loudly", () => {
    const source = buildFactBase([f(publicSchema)], []);
    // desired: create hstore, and a table+column whose type comes from hstore.
    // The column DEPENDS on the extension (resolver resolves an extension-member
    // type reference to the extension itself).
    const desired = buildFactBase(
      [
        f(publicSchema),
        f(hstore, publicSchema, { schema: "public", relocatable: true }),
        f(table, publicSchema, { persistence: "p" }),
        f(column, table, { type: "hstore", notNull: false }),
      ],
      [
        { from: hstore, to: publicSchema, kind: "depends" },
        { from: column, to: hstore, kind: "depends" },
      ],
    );

    // policy excludes the extension's CREATE (its `add` delta), but keeps the
    // table+column that need it.
    const policy: Policy = {
      id: "no-extension-creates",
      filter: [
        {
          match: { all: [{ verb: "add" }, { kind: "extension" }] },
          action: "exclude",
        },
      ],
    };

    // RED before the fix: planner emits CREATE TABLE (h hstore) with no
    // CREATE EXTENSION and does NOT throw. GREEN: the produced column depends on
    // hstore, which is neither produced nor in source → missing requirement.
    expect(() => plan(source, desired, { policy })).toThrow(
      /missing requirement/,
    );
  });

  test("the same plan WITHOUT the filter succeeds (no false positive)", () => {
    const source = buildFactBase([f(publicSchema)], []);
    const desired = buildFactBase(
      [
        f(publicSchema),
        f(hstore, publicSchema, { schema: "public", relocatable: true }),
        f(table, publicSchema, { persistence: "p" }),
        f(column, table, { type: "hstore", notNull: false }),
      ],
      [
        { from: hstore, to: publicSchema, kind: "depends" },
        { from: column, to: hstore, kind: "depends" },
      ],
    );

    // hstore IS produced here, so the column's dependency is satisfied.
    const thePlan = plan(source, desired);
    expect(thePlan.actions.some((a) => /CREATE EXTENSION/i.test(a.sql))).toBe(
      true,
    );
  });
});
