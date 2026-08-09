/**
 * Unit tests for projected plan target (src/plan/project.ts).
 * No Docker / database required.
 *
 * Hardening Item 1 / review #2: the plan only applies KEPT deltas, so the state
 * it reaches is `desired` with every FILTERED delta reverted to its source
 * value. The target fingerprint and the proof must target THIS, not full
 * `desired` — otherwise a policy-hidden delta makes the plan intentionally not
 * converge while the metadata claims the unprojected target.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import type { Delta } from "../core/diff.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";
import type { Policy } from "../policy/policy.ts";
import { projectTarget } from "./project.ts";

const schemaPublic: StableId = { kind: "schema", name: "public" };
const users: StableId = { kind: "table", schema: "public", name: "users" };
const legacy: StableId = { kind: "table", schema: "public", name: "legacy" };
const usersEmail: StableId = {
  kind: "column",
  schema: "public",
  table: "users",
  name: "email",
};

function makeFact(
  id: StableId,
  payload: Payload = {},
  parent?: StableId,
): Fact {
  return parent ? { id, parent, payload } : { id, payload };
}

describe("projectTarget — revert filtered deltas to source", () => {
  test("empty filtered list returns desired unchanged", () => {
    const desired = buildFactBase([makeFact(schemaPublic)], []);
    expect(projectTarget(desired, []).rootHash).toBe(desired.rootHash);
  });

  test("filtered remove restores the source fact in the target", () => {
    // desired dropped `legacy`; the drop was filtered → target keeps it
    const desired = buildFactBase(
      [makeFact(schemaPublic), makeFact(users, {}, schemaPublic)],
      [],
    );
    const filtered: Delta[] = [
      {
        verb: "remove",
        fact: makeFact(legacy, { persistence: "p" }, schemaPublic),
      },
    ];
    const projected = projectTarget(desired, filtered);
    expect(projected.has(legacy)).toBe(true);
  });

  test("filtered add removes the fact from the target", () => {
    const desired = buildFactBase(
      [makeFact(schemaPublic), makeFact(legacy, {}, schemaPublic)],
      [],
    );
    const filtered: Delta[] = [
      { verb: "add", fact: makeFact(legacy, {}, schemaPublic) },
    ];
    const projected = projectTarget(desired, filtered);
    expect(projected.has(legacy)).toBe(false);
  });

  test("filtered set reverts the attribute to its source value", () => {
    const desired = buildFactBase(
      [
        makeFact(schemaPublic),
        makeFact(users, {}, schemaPublic),
        makeFact(usersEmail, { type: "text" }, users),
      ],
      [],
    );
    const sourceColumn = buildFactBase(
      [
        makeFact(schemaPublic),
        makeFact(users, {}, schemaPublic),
        makeFact(usersEmail, { type: "varchar" }, users),
      ],
      [],
    );
    const filtered: Delta[] = [
      {
        verb: "set",
        id: usersEmail,
        attr: "type",
        from: "varchar",
        to: "text",
      },
    ];
    const projected = projectTarget(desired, filtered);
    // the reverted column hashes identically to the source column
    expect(projected.hashOf(usersEmail)).toBe(sourceColumn.hashOf(usersEmail));
  });

  test("filtered add that would orphan a kept child drops the child too", () => {
    // desired adds legacy + a column on it; filtering the table add must not
    // leave the column parentless (buildFactBase would otherwise throw)
    const legacyCol: StableId = {
      kind: "column",
      schema: "public",
      table: "legacy",
      name: "id",
    };
    const desired = buildFactBase(
      [
        makeFact(schemaPublic),
        makeFact(legacy, {}, schemaPublic),
        makeFact(legacyCol, { type: "integer" }, legacy),
      ],
      [],
    );
    const filtered: Delta[] = [
      { verb: "add", fact: makeFact(legacy, {}, schemaPublic) },
    ];
    const projected = projectTarget(desired, filtered);
    expect(projected.has(legacy)).toBe(false);
    expect(projected.has(legacyCol)).toBe(false);
  });
});

describe("plan target reflects the managed view (review #2)", () => {
  test("a scope-excluded object is outside the view — never dropped, no action", () => {
    // source has `legacy`; desired drops it; the policy scopes `legacy` OUT of
    // the managed universe. In the managed-view model (move 3) `legacy` is
    // projected from BOTH sides at the fact level, so it is not a "suppressed
    // drop" delta — it simply isn't part of the diff. The user-facing guarantee
    // (legacy is never dropped) holds, and the proof applies the same view.
    const source = buildFactBase(
      [
        makeFact(schemaPublic),
        makeFact(users, {}, schemaPublic),
        makeFact(legacy, { persistence: "p" }, schemaPublic),
      ],
      [],
    );
    const desired = buildFactBase(
      [makeFact(schemaPublic), makeFact(users, {}, schemaPublic)],
      [],
    );
    const policy: Policy = {
      id: "scope-out-legacy",
      filter: [
        {
          match: { all: [{ kind: "table" }, { name: "legacy" }] },
          action: "exclude",
        },
      ],
    };
    const p = plan(source, desired, { policy });
    expect(p.actions.length).toBe(0); // legacy is outside the view → nothing to do
    // the plan is a no-op in the view: its target equals its (projected) source,
    // so applying it drops nothing — legacy survives.
    expect(p.target.fingerprint).toBe(p.source.fingerprint);
  });
});
