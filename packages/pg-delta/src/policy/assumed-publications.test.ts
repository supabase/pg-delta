/**
 * Assumed publications (#370): the Supabase platform creates the
 * `supabase_realtime` publication at project init (owned by `postgres`, so no
 * owner/schema rule catches it). Users manage its MEMBERSHIP (`ALTER
 * PUBLICATION … ADD TABLE`) but never the publication object itself, so the
 * policy must keep the publication fact REFERENCE-ONLY — never created,
 * dropped, or altered — while its `publicationRel` children stay fully managed.
 *
 * Mirrors `assumedSchemas` (auth.users): a scope-excluded publication whose
 * name is in the policy's `assumedPublications` goes reference-only instead of
 * hard-pruned, so membership children survive and diff at rel grain.
 *
 * No Docker / database required.
 */
import { describe, expect, test } from "bun:test";
import { diff } from "../core/diff.ts";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { flattenPolicy, resolveView, type Policy } from "./policy.ts";
import { supabasePolicy } from "./supabase.ts";

const schemaPublic: StableId = { kind: "schema", name: "public" };
const table: StableId = { kind: "table", schema: "public", name: "t" };
const realtimePub: StableId = {
  kind: "publication",
  name: "supabase_realtime",
};
const realtimeRel: StableId = {
  kind: "publicationRel",
  publication: "supabase_realtime",
  schema: "public",
  table: "t",
};
const userPub: StableId = { kind: "publication", name: "my_pub" };

function makeFact(id: StableId, payload: Payload = {}, parent?: StableId): Fact {
  return parent ? { id, parent, payload } : { id, payload };
}

const pubPayload: Payload = {
  allTables: false,
  viaRoot: false,
  publish: ["insert", "update", "delete", "truncate"],
};

/** The live target: platform publication + a user table added to it, plus a
 *  user-created publication as the over-exclusion control. */
function targetBase() {
  return buildFactBase(
    [
      makeFact(schemaPublic),
      makeFact(table, { persistence: "p" }, schemaPublic),
      makeFact(realtimePub, pubPayload),
      makeFact(realtimeRel, { columns: null, where: null }, realtimePub),
      makeFact(userPub, pubPayload),
    ],
    [],
  );
}

/** The declarative source: user files never mention the platform publication
 *  (nor its membership, nor the user publication). */
function desiredBase() {
  return buildFactBase(
    [makeFact(schemaPublic), makeFact(table, { persistence: "p" }, schemaPublic)],
    [],
  );
}

describe("supabase policy: assumed platform publications (#370)", () => {
  test("supabase_realtime is kept reference-only, not hard-pruned", () => {
    const view = resolveView(targetBase(), supabasePolicy);
    expect(view.has(realtimePub)).toBe(true);
    expect(view.isReferenceOnly(realtimePub)).toBe(true);
  });

  test("its publicationRel membership children stay fully managed", () => {
    const view = resolveView(targetBase(), supabasePolicy);
    expect(view.has(realtimeRel)).toBe(true);
    expect(view.isReferenceOnly(realtimeRel)).toBe(false);
  });

  test("a user-created publication stays fully managed (no over-exclusion)", () => {
    const view = resolveView(targetBase(), supabasePolicy);
    expect(view.has(userPub)).toBe(true);
    expect(view.isReferenceOnly(userPub)).toBe(false);
  });

  test("desired state omitting the platform publication diffs membership only", () => {
    // The #370 apply-side symptom: files that never declared supabase_realtime
    // must not plan DROP PUBLICATION — only the rel-grain membership delta.
    const source = resolveView(targetBase(), supabasePolicy);
    const desired = resolveView(desiredBase(), supabasePolicy);
    const deltas = diff(source, desired);
    const removedIds = deltas
      .filter((d) => d.verb === "remove")
      .map((d) => encodeId(d.fact.id));
    expect(removedIds).toContain(encodeId(realtimeRel));
    expect(removedIds).not.toContain(encodeId(realtimePub));
    // the user publication IS managed drift and still drops
    expect(removedIds).toContain(encodeId(userPub));
  });

  test("flattenPolicy merges assumedPublications across extends", () => {
    const parent: Policy = {
      id: "parent",
      assumedPublications: ["from_parent"],
    };
    const child: Policy = {
      id: "child",
      assumedPublications: ["from_child"],
      extends: [parent],
    };
    expect(flattenPolicy(child).assumedPublications.sort()).toEqual([
      "from_child",
      "from_parent",
    ]);
  });
});
