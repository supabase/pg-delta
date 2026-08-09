/**
 * Managed-object exclusion (docs/architecture/extension-intent.md §4.3, Deliverable A).
 *
 * Objects a stateful extension created operationally — pg_partman child
 * partitions, pgmq `q_*`/`a_*` queue tables — carry a `managedBy` edge
 * (emitted by an extension handler's capture, src/policy/extensions). The
 * extension owns their lifecycle, so they must NOT be diffed as schema: a diff
 * would drop them as drift and destroy data (CLI-1555).
 *
 * Exclusion is at the FACT level (both sides + the proof re-extract), NOT the
 * delta level — a delta-only filter would make the proof drift (the clone
 * keeps the children, `desired` lacks them). Removing them from the fact base
 * keeps the proof honest: the plan you prove == the plan you run == the
 * data-preserving plan (docs §6). This mirrors baseline subtraction
 * (src/policy/baseline.ts).
 *
 * A `managedBy`-tagged fact and its entire descendant subtree (the child
 * table's columns/constraints/indexes) are removed; edges with a removed
 * endpoint are pruned (they would otherwise dangle). Facts with no managedBy
 * provenance — e.g. a user-declared `PARTITION OF` — are untouched, so their
 * intended drops still fire (no false suppression).
 */
import type { FactBase } from "../core/fact.ts";
import { excludeByProvenance } from "./view.ts";

/**
 * Return a new FactBase with every operationally-managed fact removed: a fact
 * carrying an outgoing `managedBy` edge, plus all of its descendants. Edges
 * with a removed endpoint are dropped. If nothing is managed, `fb` is returned
 * unchanged. Thin wrapper over the shared projection primitive (view.ts).
 */
export function excludeManaged(fb: FactBase): FactBase {
  return excludeByProvenance(fb, "managedBy");
}
