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
 *  - PLATFORM-PROVISIONED (owned by an assumed system role — `assumedPresentIds`,
 *    computed by plan() from the raw owner edges) → ambient, satisfied even when
 *    kept in `desired` and absent from `source` (e.g. Supabase's
 *    `supabase_functions.http_request()`, Sentry SUPABASE-API-8CX);
 *  - otherwise kept in `desired` (reference-only) but absent from `source` → the
 *    desired side wants something the target lacks and nothing will provision →
 *    NOT exempt → throws.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { supabasePolicy } from "../policy/supabase.ts";
import { buildActionGraph } from "./internal.ts";
import { type Action, plan } from "./plan.ts";

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

// The Sentry SUPABASE-API-8CX regression: a DB-webhook trigger (`CREATE TRIGGER
// … EXECUTE FUNCTION supabase_functions.http_request(...)`) depends on a
// PLATFORM-provisioned member of an assumed schema. The desired side keeps the
// function reference-only, and a target that has never had webhooks enabled
// lacks it — but the platform provisions it, so the requirement guard must not
// refuse the plan. The discriminator from the `auth.extra` fail-fast above is
// OWNERSHIP: `http_request()` is owned by `supabase_functions_admin` (an
// assumed system role), while a user-created object in an assumed schema is
// owned by the default owner (`postgres`) or a user role.
describe("plan() — platform-provisioned members of assumed schemas", () => {
  const publicSchema: StableId = { kind: "schema", name: "public" };
  const table: StableId = {
    kind: "table",
    schema: "public",
    name: "deliverable",
  };
  const trigger: StableId = {
    kind: "trigger",
    schema: "public",
    table: "deliverable",
    name: "crud_sync",
  };
  const functionsSchema: StableId = {
    kind: "schema",
    name: "supabase_functions",
  };
  const httpRequest: StableId = {
    kind: "function",
    schema: "supabase_functions",
    name: "http_request",
    args: [],
  };

  const f = (
    id: StableId,
    parent?: StableId,
    payload: Fact["payload"] = {},
  ): Fact => (parent ? { id, parent, payload } : { id, payload });

  const triggerDef =
    "CREATE TRIGGER crud_sync AFTER INSERT ON public.deliverable FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://example.com', 'POST')";

  /** source: the table exists, webhooks were never provisioned. */
  function sourceBase(): ReturnType<typeof buildFactBase> {
    return buildFactBase(
      [f(publicSchema), f(table, publicSchema, { persistence: "p" })],
      [],
    );
  }

  /** desired: the same table plus the webhook trigger, with the platform's
   *  `supabase_functions` schema + `http_request()` present (reference-only
   *  once the policy filters them) and the function owned by `ownerRole`. */
  function desiredBase(ownerRole: string): ReturnType<typeof buildFactBase> {
    const owner: StableId = { kind: "role", name: ownerRole };
    return buildFactBase(
      [
        f(publicSchema),
        f(table, publicSchema, { persistence: "p" }),
        f(trigger, table, { def: triggerDef, enabled: "O" }),
        f(owner),
        f(functionsSchema),
        f(httpRequest, functionsSchema, { kind: "f" }),
      ],
      [
        { from: trigger, to: httpRequest, kind: "depends" },
        { from: httpRequest, to: owner, kind: "owner" },
      ],
    );
  }

  test("a webhook trigger depending on a system-role-owned assumed-schema function plans (target lacks webhooks)", () => {
    // RED before the fix: missing requirement — "depends on
    // function:supabase_functions.http_request() … (a filter may be hiding its
    // creation)". The platform guarantee that makes `supabase_functions`
    // assumed extends to its system-owned members.
    const p = plan(sourceBase(), desiredBase("supabase_functions_admin"), {
      policy: supabasePolicy,
    });
    expect(p.actions.some((a) => /CREATE TRIGGER/i.test(a.sql))).toBe(true);
    // the reference-only platform function is never created by the plan
    expect(
      p.actions.some(
        (a) =>
          /http_request/i.test(a.sql) &&
          /CREATE (OR REPLACE )?FUNCTION/i.test(a.sql),
      ),
    ).toBe(false);
  });

  test("the fail-fast is preserved when the assumed-schema dependency is owned by the default owner", () => {
    // A default-owner-owned (i.e. user-created) object in an assumed schema
    // absent from the target still fails at plan time (PR #307 review P2) —
    // nothing will provision it at apply time.
    expect(() =>
      plan(sourceBase(), desiredBase("postgres"), {
        policy: supabasePolicy,
      }),
    ).toThrow(/missing requirement/);
  });

  test("the fail-fast is preserved when the assumed-schema dependency is owned by a user role", () => {
    expect(() =>
      plan(sourceBase(), desiredBase("app_admin"), {
        policy: supabasePolicy,
      }),
    ).toThrow(/missing requirement/);
  });
});
