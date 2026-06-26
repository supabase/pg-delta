/**
 * Missing-requirement guard: an action that consumes an object WITHIN an
 * assumed schema is not a stranded reference. No Docker required.
 *
 * The guard already exempts assumed ROLES and the assumed SCHEMA OBJECT itself
 * (`consumes schema:extensions`). But a managed object can also depend on an
 * object that LIVES IN an assumed schema — e.g. a user trigger on `auth.users`,
 * or an FK to `auth.users` — which the managed view projects out. Such a
 * requirement is satisfiable: assumed schemas are present at apply time, so are
 * their contents. This pins that exemption (change B of the trigger-gap fix).
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { buildActionGraph } from "./internal.ts";
import type { Action } from "./plan.ts";

const authUsers: StableId = { kind: "table", schema: "auth", name: "users" };

function consumerAction(consume: StableId): Action {
  return {
    sql: `CREATE TRIGGER t ON ${(consume as { schema: string }).schema}.users`,
    verb: "create",
    produces: [],
    consumes: [consume],
    destroys: [],
    releases: [],
    transactionality: "transactional",
    lockClass: "shareRowExclusive",
    newSegmentBefore: false,
    dataLoss: "none",
    rewriteRisk: false,
  };
}

function fact(id: StableId): Fact {
  return { id, payload: {} };
}

describe("missing-requirement guard: objects within assumed schemas", () => {
  // source does NOT contain auth.users (managed view projected it out); desired
  // references it. No producer in the plan.
  const source = buildFactBase([], []);
  const desired = buildFactBase([fact(authUsers)], []);
  const action = consumerAction(authUsers);

  test("throws when the consumed object's schema is NOT assumed", () => {
    expect(() =>
      buildActionGraph([action], new Map(), new Map(), source, desired),
    ).toThrow(/missing requirement/);
  });

  test("is exempt when the consumed object's schema IS assumed", () => {
    expect(() =>
      buildActionGraph(
        [action],
        new Map(),
        new Map(),
        source,
        desired,
        new Set(), // renameActionIndices
        new Set(), // assumedRoleNames
        new Set(["auth"]), // assumedSchemaNames
      ),
    ).not.toThrow();
  });
});
