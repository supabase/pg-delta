import type { Catalog } from "../catalog.model.ts";
import type { Change } from "../objects/base.change.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
} from "../objects/table/changes/table.alter.ts";
import {
  refineByTopologicalWindows,
  type TopoWindowSpec,
} from "./topo-refine.ts";

// 2) Build pairwise from depends (referenced -> dependent)
type PgDependRow = {
  dependent_stable_id: string;
  referenced_stable_id: string;
};
function makePairwiseFromDepends(
  depends: PgDependRow[],
  options: { invert?: boolean } = {},
) {
  const edgesByRef = new Map<string, Set<string>>();
  for (const row of depends) {
    const ref = row.referenced_stable_id;
    const dep = row.dependent_stable_id;
    if (!edgesByRef.has(ref)) edgesByRef.set(ref, new Set());
    edgesByRef.get(ref)?.add(dep);
  }
  const hasEdge = (refs: string[], deps: string[]) => {
    for (const r of refs) {
      const outs = edgesByRef.get(r);
      if (!outs) continue;
      for (const d of deps) if (outs.has(d)) return true;
    }
    return false;
  };

  return (a: Change, b: Change) => {
    const aIds = a.dependencies,
      bIds = b.dependencies;
    if (hasEdge(aIds, bIds))
      return options.invert ? "b_before_a" : "a_before_b";
    if (hasEdge(bIds, aIds))
      return options.invert ? "a_before_b" : "b_before_a";
    return undefined;
  };
}

export interface RefinementContext {
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}

export function applyRefinements(
  ctx: RefinementContext,
  list: Change[],
): Change[] {
  const specs: TopoWindowSpec<Change>[] = [
    {
      // ALTER TABLE: columns before constraints, per table
      filter: { operation: "alter", objectType: "table" },
      pairwise: (a, b) =>
        a instanceof AlterTableAddColumn && b instanceof AlterTableAddConstraint
          ? "a_before_b"
          : undefined,
    },
    {
      // ALTER TABLE: within constraints, PRIMARY KEY before FOREIGN KEY, per table
      filter: { operation: "alter", objectType: "table" },
      pairwise: (a, b) => {
        if (
          a instanceof AlterTableAddConstraint &&
          b instanceof AlterTableAddConstraint
        ) {
          const aType = a.constraint.constraint_type;
          const bType = b.constraint.constraint_type;
          if (aType === "p" && bType === "f") return "a_before_b";
          if (aType === "f" && bType === "p") return "b_before_a";
        }
        return undefined;
      },
    },
    {
      // CREATE view/mview topo by depends (use branch)
      filter: (c) =>
        (c.operation === "create" || c.operation === "alter") &&
        (c.objectType === "view" || c.objectType === "materialized_view"),
      pairwise: makePairwiseFromDepends(ctx.branchCatalog.depends),
    },
    {
      // DROP view/mview topo by depends (use main)
      filter: (c) =>
        c.operation === "drop" &&
        (c.objectType === "view" || c.objectType === "materialized_view"),
      pairwise: makePairwiseFromDepends(ctx.mainCatalog.depends, {
        invert: true,
      }),
    },
  ];

  return specs.reduce(
    (acc, spec) => refineByTopologicalWindows(acc, spec),
    list,
  );
}
