/**
 * Single reconstruction entry point for the managed view under management scope
 * (docs/architecture/managed-view-architecture.md; agent track V1).
 *
 * Order is fixed: `resolveView` THEN `projectManagementScope`. A policy
 * owner-exclusion rule reads the `owner` edge, and database-scope role pruning
 * removes those edges with the role facts — projecting scope first would strip
 * the edge the policy needs and wrongly plan a DROP of a platform object owned
 * by a system role. Plan, prove, apply, and schema export all call this helper
 * so `plan == prove == run` cannot drift by open-coding the composition.
 *
 * Internal only — not re-exported from the package index or the `./policy`
 * public subpath. `ResolvedProfile` remains the public safe-composition surface.
 * Bare `resolveView` (without scope) stays legitimate for diff/seed paths.
 */
import type { FactBase } from "../core/fact.ts";
import type { ApplierCapability } from "./capability.ts";
import { resolveView, type Policy } from "./policy.ts";
import { projectManagementScope, type ManagementScope } from "./view.ts";

interface ReconstructManagedViewOptions {
  // `| undefined` so call sites can forward optional plan/profile fields under
  // exactOptionalPropertyTypes without conditional spreads at every site.
  policy?: Policy | undefined;
  capability?: ApplierCapability | undefined;
  baseline?: FactBase | undefined;
  /** Default `"cluster"` (identity scope projection). */
  scope?: ManagementScope | undefined;
  /** Under database scope: owner edges to this role stay implicit (no OWNER TO). */
  defaultOwner?: string | undefined;
}

/**
 * Rebuild the managed-view-under-scope: policy/capability/baseline projection,
 * then management-scope role pruning.
 */
export function reconstructManagedView(
  fb: FactBase,
  opts: ReconstructManagedViewOptions = {},
): FactBase {
  const scope = opts.scope ?? "cluster";
  const view = resolveView(fb, opts.policy, opts.capability, opts.baseline);
  return projectManagementScope(
    view,
    scope,
    opts.defaultOwner !== undefined ? { defaultOwner: opts.defaultOwner } : {},
  );
}
