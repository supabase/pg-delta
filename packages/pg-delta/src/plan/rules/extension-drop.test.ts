/**
 * DROP EXTENSION cascades to its member objects (pg_depend deptype 'e'). Members
 * are kept reference-only in the resolved view (never projected out), so the drop
 * rule derives data-loss from the member closure: destructive iff the extension
 * owns a data-bearing persisted relation (table / materialized view). An
 * extension whose members are only functions/types/etc. drops without data loss.
 *
 * This is the safety-flag counterpart to the presence-based CREATE clause
 * (extension-create.test.ts): both are PLAN-TIME properties derived from the
 * resolved view, not from an extract-time payload field.
 */
import { describe, expect, test } from "bun:test";
import type { DependencyEdge, Fact } from "../../core/fact.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import type { FactView } from "../rules.ts";
import { schemaRules } from "./schemas.ts";

const extId: StableId = { kind: "extension", name: "x" };
const extFact: Fact = { id: extId, payload: {} };

/** Minimal FactView exposing incomingEdges for the drop rule's member-closure
 *  walk. `members` are the ids that carry a `memberOfExtension` edge to ext x. */
function viewWithMembers(members: StableId[]): FactView {
  const incoming: DependencyEdge[] = members.map((from) => ({
    from,
    to: extId,
    kind: "memberOfExtension" as const,
  }));
  return {
    get: () => undefined,
    isReferenceOnly: () => false,
    childrenOf: () => [],
    facts: () => [],
    outgoingEdges: () => [],
    incomingEdges: (id) => (encodeId(id) === encodeId(extId) ? incoming : []),
    edges: [],
  };
}

const tableMember: StableId = { kind: "table", schema: "app", name: "queue" };
const matviewMember: StableId = {
  kind: "materializedView",
  schema: "app",
  name: "mv",
};
const fnMember: StableId = {
  kind: "function",
  schema: "app",
  name: "f",
  args: [],
};

describe("DROP EXTENSION data-loss (member closure)", () => {
  test("extension owning a table member → destructive", () => {
    const spec = schemaRules.extension!.drop(
      extFact,
      viewWithMembers([tableMember, fnMember]),
    );
    expect(spec.sql).toBe(`DROP EXTENSION "x"`);
    expect(spec.dataLoss).toBe("destructive");
    expect(spec.alsoDestroys).toEqual([tableMember, fnMember]);
  });

  test("extension owning a materialized-view member → destructive", () => {
    const spec = schemaRules.extension!.drop(
      extFact,
      viewWithMembers([matviewMember]),
    );
    expect(spec.dataLoss).toBe("destructive");
    expect(spec.alsoDestroys).toEqual([matviewMember]);
  });

  test("functions-only extension → non-destructive", () => {
    const spec = schemaRules.extension!.drop(
      extFact,
      viewWithMembers([fnMember]),
    );
    expect(spec.dataLoss ?? "none").toBe("none");
    expect(spec.alsoDestroys).toEqual([fnMember]);
  });

  test("no view supplied (member closure unknown) → non-destructive", () => {
    const spec = schemaRules.extension!.drop(extFact);
    expect(spec.dataLoss ?? "none").toBe("none");
  });
});
