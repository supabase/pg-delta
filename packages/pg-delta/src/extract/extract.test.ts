/**
 * Unit tests for extraction consistency invariants (src/extract/extract.ts).
 * No Docker / database required.
 *
 * Hardening Item 4a / review #1: a metadata satellite (comment / acl /
 * securityLabel) must never outlive its target. If the target object was
 * filtered (e.g. an extension member), the satellite is dropped with a
 * diagnostic — not left to throw at buildFactBase or orphan into a GRANT with
 * no CREATE (CLI-1471).
 */
import { describe, expect, test } from "bun:test";
import type { Fact } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { catalogBatchPlan, pruneOrphanedSatellites } from "./extract.ts";

const present: StableId = { kind: "table", schema: "public", name: "present" };
const filtered: StableId = {
  kind: "aggregate",
  schema: "public",
  name: "last",
  args: ["anyelement"],
};

describe("pruneOrphanedSatellites — satellites never outlive their target", () => {
  test("drops acl/comment/securityLabel whose target is absent; keeps the rest", () => {
    const facts: Fact[] = [
      { id: present, payload: {} },
      // keep: target present
      {
        id: { kind: "acl", target: present, grantee: "r" },
        parent: present,
        payload: { privileges: ["SELECT"] },
      },
      // drop: target (an extension-member aggregate) was filtered out
      {
        id: { kind: "acl", target: filtered, grantee: "r" },
        parent: filtered,
        payload: { privileges: ["ALL"] },
      },
      {
        id: { kind: "comment", target: filtered },
        parent: filtered,
        payload: { text: "x" },
      },
      {
        id: { kind: "securityLabel", target: filtered, provider: "p" },
        parent: filtered,
        payload: { label: "secret" },
      },
    ];
    const { facts: kept, diagnostics } = pruneOrphanedSatellites(facts);

    const keptIds = kept.map((f) => encodeId(f.id));
    expect(keptIds).toContain(encodeId(present));
    expect(keptIds).toContain(
      encodeId({ kind: "acl", target: present, grantee: "r" }),
    );
    // the three satellites targeting the filtered aggregate are gone
    expect(kept).toHaveLength(2);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.every((d) => d.severity === "info")).toBe(true);
  });

  test("no-op when every satellite's target is present", () => {
    const facts: Fact[] = [
      { id: present, payload: {} },
      {
        id: { kind: "comment", target: present },
        parent: present,
        payload: { text: "ok" },
      },
    ];
    const { facts: kept, diagnostics } = pruneOrphanedSatellites(facts);
    expect(kept).toHaveLength(2);
    expect(diagnostics).toHaveLength(0);
  });
});

/**
 * The catalog batch plan is resolved at module load and refuses to build when
 * the grouping and the family registry disagree — a batched family left out of
 * every group would contribute NO facts, which reads downstream as "the user
 * dropped all those objects". These pin the invariants the resolver enforces,
 * and (by importing the module at all) that the resolver actually ran.
 */
describe("catalog batch plan", () => {
  const plan = catalogBatchPlan();
  const grouped = plan.groups.flat();

  test("every batched family is grouped exactly once", () => {
    const batched = plan.families
      .filter((f) => f.kind === "batched")
      .map((f) => f.name);
    expect(grouped.slice().sort()).toEqual(batched.slice().sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  test("no heavy or opaque family is ever batched", () => {
    const unbatchable = new Set(
      plan.families.filter((f) => f.kind !== "batched").map((f) => f.name),
    );
    for (const name of grouped) expect(unbatchable.has(name)).toBe(false);
  });

  test("family names are unique — they key the grouping", () => {
    const names = plan.families.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("the tail is packed into a handful of balanced groups", () => {
    // 2-3 groups: one giant group is a serial tail on a single stream, one group
    // per family is the per-family round trips the batching exists to remove.
    expect(plan.groups.length).toBeGreaterThanOrEqual(2);
    expect(plan.groups.length).toBeLessThanOrEqual(3);
    for (const group of plan.groups) expect(group.length).toBeGreaterThan(0);
  });

  test("the three unbatchable families are the probe-branching ones", () => {
    // These BRANCH on the result of one of their own earlier queries, so their
    // statement list is not knowable up front (see FamilyEntry).
    expect(
      plan.families.filter((f) => f.kind === "opaque").map((f) => f.name),
    ).toEqual(["foreign", "subscriptions", "securityLabels"]);
  });
});
