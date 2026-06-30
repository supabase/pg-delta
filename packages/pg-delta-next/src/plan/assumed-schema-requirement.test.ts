/**
 * Missing-requirement guard for objects WITHIN an assumed schema. No Docker.
 *
 * A managed object can depend on something that lives in an assumed schema —
 * e.g. a user trigger on `auth.users`, or a column of an extension type in
 * `extensions`. The guard must satisfy those that are genuinely present at
 * apply time WITHOUT exempting a desired-side reference to an assumed-schema
 * object the target does NOT have (PR #307 review #3499413404): the latter must
 * fail at PLAN time rather than at apply against a missing relation.
 *
 * The decisive signal:
 *  - present on the target → kept reference-only in `source` → `source.has` is
 *    true → satisfied (the in-schema exemption never even runs);
 *  - external to the managed view (e.g. an extension member, hard-pruned from
 *    both sides) → not in `desired` → ambient, satisfied;
 *  - kept in `desired` (reference-only) but absent from `source` → the desired
 *    side wants something the target lacks → NOT exempt → throws.
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

function run(
  source: ReturnType<typeof buildFactBase>,
  desired: ReturnType<typeof buildFactBase>,
  assumedSchemas: Set<string>,
): void {
  buildActionGraph(
    [consumerAction(authUsers)],
    new Map(),
    new Map(),
    source,
    desired,
    new Set(), // renameActionIndices
    new Set(), // assumedRoleNames
    assumedSchemas,
  );
}

describe("missing-requirement guard: objects within assumed schemas", () => {
  test("throws when absent from source and the schema is NOT assumed", () => {
    const source = buildFactBase([], []);
    const desired = buildFactBase([fact(authUsers)], []);
    expect(() => run(source, desired, new Set())).toThrow(
      /missing requirement/,
    );
  });

  test("throws when kept in the desired view but absent from source, even if the schema IS assumed", () => {
    // the desired side references an assumed-schema object the TARGET lacks
    // (e.g. a brand-new `auth.extra`) — apply would fail, so fail at plan time.
    const source = buildFactBase([], []);
    const desired = buildFactBase([fact(authUsers)], []);
    expect(() => run(source, desired, new Set(["auth"]))).toThrow(
      /missing requirement/,
    );
  });

  test("is exempt when the object is present on the target (reference-only in source)", () => {
    // resolveView keeps a present platform table as reference-only in BOTH sides,
    // so source.has is true and the requirement is satisfied directly.
    const source = buildFactBase([fact(authUsers)], []);
    const desired = buildFactBase([fact(authUsers)], []);
    expect(() => run(source, desired, new Set(["auth"]))).not.toThrow();
  });

  test("is exempt when the object is external to the managed view (e.g. an extension member) in an assumed schema", () => {
    // hard-pruned from both sides (not in source, not in desired) — genuinely
    // ambient (present at apply via its extension).
    const source = buildFactBase([], []);
    const desired = buildFactBase([], []);
    expect(() => run(source, desired, new Set(["auth"]))).not.toThrow();
  });
});
