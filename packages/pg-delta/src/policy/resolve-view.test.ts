/**
 * resolveView (docs/architecture/managed-view-architecture.md move 3): the policy's
 * non-`verb` scope rules are applied as a FACT-LEVEL projection (both sides +
 * proof reextract), so the proof stays honest by construction. First-match-wins
 * is respected, including the safety case where an operation (`verb`) include
 * earlier in the list protects a fact a later scope exclude would remove —
 * over-projecting would silently drop managed objects, so the rule is: only
 * project a fact out when certain ALL its deltas are excluded; otherwise keep
 * it (the existing delta-level filter still applies).
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import type { Policy } from "./policy.ts";
import { resolveView } from "./policy.ts";
import { excludeByProvenance } from "./view.ts";

const f = (id: StableId, payload: Fact["payload"] = {}): Fact => ({
  id,
  payload,
});
const schema = (name: string): StableId => ({ kind: "schema", name });
const table = (s: string, name: string): StableId => ({
  kind: "table",
  schema: s,
  name,
});
const role = (name: string): StableId => ({ kind: "role", name });
const ext = (name: string): StableId => ({ kind: "extension", name });

describe("resolveView — fact-level scope projection", () => {
  test("a pure scope exclude removes matching facts; others survive", () => {
    const policy: Policy = {
      id: "p",
      filter: [{ match: { schema: "auth" }, action: "exclude" }],
    };
    const fb = buildFactBase(
      [f(schema("auth")), f(table("auth", "users")), f(table("public", "app"))],
      [],
    );
    const view = resolveView(fb, policy);
    expect(view.get(table("auth", "users"))).toBeUndefined();
    expect(view.get(table("public", "app"))).toBeDefined();
  });

  test("an earlier scope include protects a fact from a later scope exclude", () => {
    const policy: Policy = {
      id: "p",
      filter: [
        { match: { name: "keepme" }, action: "include" },
        { match: { schema: "auth" }, action: "exclude" },
      ],
    };
    const fb = buildFactBase(
      [f(schema("auth")), f(table("auth", "keepme")), f(table("auth", "drop"))],
      [],
    );
    const view = resolveView(fb, policy);
    expect(view.get(table("auth", "keepme"))).toBeDefined();
    expect(view.get(table("auth", "drop"))).toBeUndefined();
  });

  test("SAFETY: an operation (verb) include earlier protects a fact a later scope exclude matches", () => {
    // Mirrors the Supabase policy: rule 1 includes extension add/remove; a later
    // rule excludes objects owned by a system role. An extension owned by that
    // role must NOT be projected out (its add/remove is included).
    const policy: Policy = {
      id: "p",
      filter: [
        {
          match: { all: [{ kind: "extension" }, { verb: ["add", "remove"] }] },
          action: "include",
        },
        { match: { owner: "sys" }, action: "exclude" },
      ],
    };
    const fb = buildFactBase(
      [f(role("sys")), f(ext("pgmq"), { owner: "sys", relocatable: false })],
      [],
    );
    const view = resolveView(fb, policy);
    // protected by the operation-include → still present at the fact level
    expect(view.get(ext("pgmq"))).toBeDefined();
  });

  test("a verb exclude alone never projects a fact out wholesale", () => {
    const policy: Policy = {
      id: "p",
      filter: [{ match: { verb: "remove" }, action: "exclude" }],
    };
    const fb = buildFactBase([f(table("public", "t"))], []);
    expect(resolveView(fb, policy).get(table("public", "t"))).toBeDefined();
  });

  test("no policy → extension members kept REFERENCE-ONLY (not hard-pruned)", () => {
    const member = table("public", "q_jobs");
    const fb = buildFactBase(
      [f(schema("public")), f(ext("pgmq")), f(member)],
      [{ from: member, to: ext("pgmq"), kind: "memberOfExtension" }],
    );
    const viaResolve = resolveView(fb, undefined);
    const viaExclude = excludeByProvenance(fb, "memberOfExtension");
    // The raw primitive hard-prunes the member; resolveView keeps it
    // REFERENCE-ONLY so its satellite customizations (acl/comment/securityLabel)
    // stay diffable while the member object itself is never diffed.
    expect(viaExclude.get(member)).toBeUndefined();
    expect(viaResolve.get(member)).toBeDefined();
    expect(viaResolve.referenceOnly.has(encodeId(member))).toBe(true);
    // a non-member (the schema) is neither pruned nor reference-only
    expect(viaResolve.get(schema("public"))).toBeDefined();
    expect(viaResolve.referenceOnly.has(encodeId(schema("public")))).toBe(
      false,
    );
  });

  test("member stays reference-only when baseline subtraction prunes its extension edge", () => {
    const netSchema = schema("net");
    const pgNet = ext("pg_net");
    const memberFn: StableId = {
      kind: "function",
      schema: "net",
      name: "http_get",
      args: [],
    };
    const aclFact: Fact = {
      id: { kind: "acl", target: memberFn, grantee: "r" },
      parent: memberFn,
      payload: { privileges: ["EXECUTE"], grantable: [] },
    };
    const edge = {
      from: memberFn,
      to: pgNet,
      kind: "memberOfExtension" as const,
    };
    // fb has the extension, its member function, and a user GRANT on the member.
    const fb = buildFactBase(
      [f(netSchema), f(pgNet, netSchema), f(memberFn, netSchema), aclFact],
      [edge],
    );
    // Baseline is identical EXCEPT the user grant → subtractBaseline drops the
    // extension + function, but force-keeps the function (its acl survives) and
    // PRUNES the now-dangling member edge.
    const baseline = buildFactBase(
      [f(netSchema), f(pgNet, netSchema), f(memberFn, netSchema)],
      [edge],
    );
    const view = resolveView(fb, undefined, undefined, baseline);
    // RED today: the member closure is computed AFTER subtraction, when the edge
    // is already gone, so the surviving function is NOT reference-only and would
    // be planned as a spurious CREATE FUNCTION.
    expect(view.get(memberFn)).toBeDefined();
    expect(view.referenceOnly.has(encodeId(memberFn))).toBe(true);
  });

  test("managedBy facts are projected out (no policy) — single projection point", () => {
    // P0: resolveView must be the single projection point for BOTH provenance
    // kinds. Operationally-managed objects (pg_partman children) carry a
    // `managedBy` edge and must drop out of the diffed view exactly like
    // extension members, otherwise the default plan path drops them as drift.
    const child = table("public", "events_p20260101");
    const childCol: StableId = {
      kind: "column",
      schema: "public",
      table: "events_p20260101",
      name: "id",
    };
    const fb = buildFactBase(
      [
        f(schema("public")),
        f(ext("pg_partman")),
        f(table("public", "events"), { partitioned: true }),
        f(child, { partitioned: false }),
        { id: childCol, parent: child, payload: { type: "integer" } },
      ],
      [
        { from: child, to: ext("pg_partman"), kind: "managedBy" },
        { from: child, to: table("public", "events"), kind: "depends" },
      ],
    );
    const view = resolveView(fb, undefined);
    expect(view.get(child)).toBeUndefined(); // managed child removed
    expect(view.get(childCol)).toBeUndefined(); // descendant pruned too
    expect(view.get(table("public", "events"))).toBeDefined(); // parent survives
    expect(view.get(ext("pg_partman"))).toBeDefined();
  });

  test("an extension intent fact survives managedBy projection; managed objects don't", () => {
    // An intent fact carries only an OUTGOING `depends` edge to its extension —
    // it must NOT carry an outgoing `managedBy` edge (that marks operationally-
    // created objects for projection). So it survives resolveView, while a table
    // the extension created operationally (outgoing `managedBy`) is projected out
    // with its subtree. Pins the one handler-authoring rule: never attach a
    // `managedBy` edge FROM the intent fact.
    const cronJob: StableId = {
      kind: "extensionIntent",
      ext: "pg_cron",
      intentKind: "job",
      key: "nightly",
    };
    const managedTable = table("public", "q_events");
    const fb = buildFactBase(
      [f(schema("public")), f(ext("pg_cron")), f(cronJob), f(managedTable)],
      [
        { from: cronJob, to: ext("pg_cron"), kind: "depends" },
        { from: managedTable, to: ext("pg_cron"), kind: "managedBy" },
      ],
    );
    const view = resolveView(fb, undefined);
    expect(view.get(cronJob)).toBeDefined(); // intent fact survives
    expect(view.get(managedTable)).toBeUndefined(); // operational object projected
    // and the primitive directly, for the invariant:
    expect(excludeByProvenance(fb, "managedBy").get(cronJob)).toBeDefined();
  });

  test("the { owner } predicate resolves via the owner edge (move 2)", () => {
    // owner left the payload; an { owner } scope rule must match through the
    // `owner` edge (object --owner--> role). This is the Supabase Rule 6 path.
    const sys = role("sys");
    const owned = table("public", "owned");
    const free = table("public", "free");
    const policy: Policy = {
      id: "p",
      filter: [{ match: { owner: "sys" }, action: "exclude" }],
    };
    const fb = buildFactBase(
      [f(schema("public")), f(sys), f(owned), f(free)],
      [{ from: owned, to: sys, kind: "owner" }],
    );
    const view = resolveView(fb, policy);
    expect(view.get(owned)).toBeUndefined(); // matched by { owner } via the edge
    expect(view.get(free)).toBeDefined(); // no owner edge → not matched
  });
});
