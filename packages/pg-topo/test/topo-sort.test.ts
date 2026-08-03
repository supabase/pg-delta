import { describe, expect, test } from "bun:test";
import { topoSort } from "../src/graph/topo-sort.ts";
import type { StatementNode } from "../src/model/types.ts";

const node = (filePath: string): StatementNode => ({
  id: { filePath, statementIndex: 0 },
  sql: `create view ${filePath.replaceAll(/\W/g, "_")} as select 1;`,
  statementClass: "CREATE_VIEW",
  provides: [],
  requires: [],
  phase: "post_data",
  annotations: {
    dependsOn: [],
    requires: [],
    provides: [],
  },
});

describe("topoSort", () => {
  test("orders chained cycle components by dependency before tie-break keys", () => {
    const nodes = [
      node("z-upstream-a.sql"),
      node("z-upstream-b.sql"),
      node("a-downstream-a.sql"),
      node("a-downstream-b.sql"),
    ];
    const edges = new Map([
      [0, new Set([1, 2])],
      [1, new Set([0])],
      [2, new Set([3])],
      [3, new Set([2])],
    ]);

    const result = topoSort(nodes, edges);

    expect(result.orderedIndices).toEqual([0, 1, 2, 3]);
    expect(result.orderedIndices).toHaveLength(nodes.length);
    expect(new Set(result.orderedIndices)).toHaveLength(nodes.length);
    expect(result.cycleGroups).toEqual([
      [2, 3],
      [0, 1],
    ]);
  });

  test("keeps the maximal acyclic prefix before independent deterministic cycle components", () => {
    const nodes = [
      node("z-acyclic-prefix.sql"),
      node("b-cycle-a.sql"),
      node("b-cycle-b.sql"),
      node("a-cycle-a.sql"),
      node("a-cycle-b.sql"),
    ];
    const edges = new Map([
      [0, new Set([1, 3])],
      [1, new Set([2])],
      [2, new Set([1])],
      [3, new Set([4])],
      [4, new Set([3])],
    ]);

    const result = topoSort(nodes, edges);

    expect(result.orderedIndices).toEqual([0, 3, 4, 1, 2]);
    expect(result.orderedIndices).toHaveLength(nodes.length);
    expect(new Set(result.orderedIndices)).toHaveLength(nodes.length);
    expect(result.cycleGroups).toEqual([
      [3, 4],
      [1, 2],
    ]);
    expect(topoSort(nodes, edges)).toEqual(result);
  });
});
