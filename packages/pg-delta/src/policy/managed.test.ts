/**
 * Unit tests for managed-object exclusion (src/policy/managed.ts).
 * No Docker / database required.
 *
 * Stateful-extension intent, Deliverable A (docs/architecture/extension-intent.md §4.3):
 * objects an extension created operationally (pg_partman child partitions,
 * pgmq queue tables) carry a `managedBy` edge and must be excluded from the
 * schema fact base on BOTH sides — never diffed, so the plan never drops them
 * (CLI-1555). Fact-level exclusion (not delta-level) keeps the proof honest
 * (docs §6): the plan you prove == the plan you run.
 */

import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import { diff } from "../core/diff.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { excludeManaged } from "./managed.ts";

// ---------------------------------------------------------------------------
// Helpers: a partitioned parent + one partman-managed child partition
// ---------------------------------------------------------------------------

const schemaPublic: StableId = { kind: "schema", name: "public" };
const extPartman: StableId = { kind: "extension", name: "pg_partman" };
const parentTable: StableId = {
  kind: "table",
  schema: "public",
  name: "events",
};
const childPartition: StableId = {
  kind: "table",
  schema: "public",
  name: "events_p20260101",
};
const childColumn: StableId = {
  kind: "column",
  schema: "public",
  table: "events_p20260101",
  name: "id",
};

function makeFact(
  id: StableId,
  payload: Payload = {},
  parent?: StableId,
): Fact {
  return parent ? { id, parent, payload } : { id, payload };
}

/** Source: the live DB — partitioned parent + a partman child (with a column),
 *  the child tagged `managedBy` the pg_partman extension + a partition
 *  `depends` edge to the parent. */
function sourceBase() {
  const facts: Fact[] = [
    makeFact(schemaPublic),
    makeFact(extPartman, {}, schemaPublic),
    makeFact(
      parentTable,
      { persistence: "p", partitioned: true },
      schemaPublic,
    ),
    makeFact(
      childPartition,
      { persistence: "p", partitioned: false },
      schemaPublic,
    ),
    makeFact(childColumn, { type: "integer" }, childPartition),
  ];
  const edges: DependencyEdge[] = [
    { from: childPartition, to: extPartman, kind: "managedBy" },
    { from: childPartition, to: parentTable, kind: "depends" },
  ];
  return buildFactBase(facts, edges);
}

/** Desired: the declarative source — only the parent is declared; pg_partman
 *  creates children at runtime, so the shadow has no child. */
function desiredBase() {
  const facts: Fact[] = [
    makeFact(schemaPublic),
    makeFact(extPartman, {}, schemaPublic),
    makeFact(
      parentTable,
      { persistence: "p", partitioned: true },
      schemaPublic,
    ),
  ];
  return buildFactBase(facts, []);
}

const removesChild = (deltas: ReturnType<typeof diff>) =>
  deltas.some(
    (d) =>
      d.verb === "remove" && encodeId(d.fact.id) === encodeId(childPartition),
  );

// ---------------------------------------------------------------------------

describe("excludeManaged — Deliverable A (stop dropping managed partitions)", () => {
  test("control: a raw diff DROPS the partman child (the CLI-1555 bug)", () => {
    // proves the scenario actually reproduces the destructive drop
    expect(removesChild(diff(sourceBase(), desiredBase()))).toBe(true);
  });

  test("excluding managed facts removes the child + its descendants from the base", () => {
    const pruned = excludeManaged(sourceBase());
    expect(pruned.has(childPartition)).toBe(false);
    expect(pruned.has(childColumn)).toBe(false); // descendant pruned too
  });

  test("the partitioned PARENT and the extension survive exclusion", () => {
    const pruned = excludeManaged(sourceBase());
    expect(pruned.has(parentTable)).toBe(true);
    expect(pruned.has(extPartman)).toBe(true);
    expect(pruned.has(schemaPublic)).toBe(true);
  });

  test("after exclusion on both sides, the diff no longer drops the child", () => {
    const deltas = diff(
      excludeManaged(sourceBase()),
      excludeManaged(desiredBase()),
    );
    expect(removesChild(deltas)).toBe(false);
  });

  test("a NON-managed table absent from desired is still dropped (no false suppression)", () => {
    // a user-declared partition removed on the desired side MUST still drop
    const userPartition: StableId = {
      kind: "table",
      schema: "public",
      name: "user_part_2025",
    };
    const src = buildFactBase(
      [
        makeFact(schemaPublic),
        makeFact(parentTable, { persistence: "p" }, schemaPublic),
        makeFact(userPartition, { persistence: "p" }, schemaPublic),
      ],
      [{ from: userPartition, to: parentTable, kind: "depends" }],
    );
    const desired = buildFactBase(
      [
        makeFact(schemaPublic),
        makeFact(parentTable, { persistence: "p" }, schemaPublic),
      ],
      [],
    );
    const deltas = diff(excludeManaged(src), excludeManaged(desired));
    const dropsUser = deltas.some(
      (d) =>
        d.verb === "remove" && encodeId(d.fact.id) === encodeId(userPartition),
    );
    expect(dropsUser).toBe(true);
  });
});
