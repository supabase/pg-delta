/**
 * Reference-only assumed-schema objects (A1' / trigger-gap fix, scoped).
 *
 * A platform schema like `auth` is declared in `assumedSchemas` (present at
 * apply time, not managed). Its objects must be kept in the managed view as
 * REFERENCE-ONLY — present so a managed dependent (a user trigger on
 * `auth.users`) can resolve its parent, but never diffed (no CREATE/ALTER/DROP).
 *
 * This pins the core mechanism without a database:
 *  - resolveView keeps the assumed-schema table (not pruned) AND the user
 *    trigger attached to it (include rule), instead of pruning the whole subtree.
 *  - diff emits the trigger delta but NO delta for the reference-only table,
 *    even when the table is asymmetric across the two sides.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { diff } from "../core/diff.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import type { Policy } from "./policy.ts";
import { resolveView } from "./policy.ts";

const schemaAuth: StableId = { kind: "schema", name: "auth" };
const tableUsers: StableId = { kind: "table", schema: "auth", name: "users" };
const trigger: StableId = {
  kind: "trigger",
  schema: "auth",
  table: "users",
  name: "on_auth_user_created",
};

function f(id: StableId, parent?: StableId): Fact {
  return parent ? { id, parent, payload: {} } : { id, payload: {} };
}

// auth is assumed-present; triggers are user-managed (kept) even in auth.
const policy: Policy = {
  id: "ref-only-test",
  assumedSchemas: ["auth"],
  filter: [
    { match: { kind: "trigger" }, action: "include" },
    { match: { schema: ["auth"] }, action: "exclude" },
    {
      match: { all: [{ kind: "schema" }, { name: ["auth"] }] },
      action: "exclude",
    },
  ],
};

describe("reference-only assumed-schema objects", () => {
  // both sides have the platform table; only the desired side has the trigger.
  const sourceRaw = buildFactBase(
    [f(schemaAuth), f(tableUsers, schemaAuth)],
    [],
  );
  const desiredRaw = buildFactBase(
    [f(schemaAuth), f(tableUsers, schemaAuth), f(trigger, tableUsers)],
    [],
  );

  test("resolveView keeps the user trigger attached to an assumed-schema table", () => {
    const view = resolveView(desiredRaw, policy);
    expect(view.has(trigger)).toBe(true);
    // the platform table is kept too (reference-only), so the trigger's parent
    // resolves — no orphan.
    expect(view.has(tableUsers)).toBe(true);
  });

  test("diff emits the trigger but never a delta for the reference-only table", () => {
    const source = resolveView(sourceRaw, policy);
    const desired = resolveView(desiredRaw, policy);
    const deltas = diff(source, desired);
    const triggerKey = encodeId(trigger);
    const tableKey = encodeId(tableUsers);
    const schemaKey = encodeId(schemaAuth);
    const subj = (d: (typeof deltas)[number]): string =>
      d.verb === "add" || d.verb === "remove"
        ? encodeId(d.fact.id)
        : d.verb === "set"
          ? encodeId(d.id)
          : encodeId(d.edge.from);
    expect(deltas.some((d) => d.verb === "add" && subj(d) === triggerKey)).toBe(
      true,
    );
    expect(deltas.some((d) => subj(d) === tableKey)).toBe(false);
    expect(deltas.some((d) => subj(d) === schemaKey)).toBe(false);
  });

  test("a reference-only object asymmetric across sides still emits no delta", () => {
    // desired lacks the platform table entirely; source has it. A plain diff
    // would emit `remove auth.users` — reference-only must suppress it.
    const onlySource = resolveView(
      buildFactBase([f(schemaAuth), f(tableUsers, schemaAuth)], []),
      policy,
    );
    const empty = resolveView(buildFactBase([], []), policy);
    const deltas = diff(onlySource, empty);
    expect(deltas).toEqual([]);
  });
});
