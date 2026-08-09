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
import { pruneOrphanedSatellites } from "./extract.ts";

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
