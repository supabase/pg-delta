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
import { diff, subjectOf, type Delta } from "../core/diff.ts";
import type { DependencyEdge, FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import type { ApplierCapability } from "./capability.ts";
import { resolveView, type Policy } from "./policy.ts";
import {
  projectManagementScope,
  type ManagementScope,
  type ProjectionAuditClassification,
  type ProjectionAuditStage,
  type ProjectionAuditSubject,
  type ProjectionSuppression,
} from "./view.ts";

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
  /** Optional attributed-suppression sink. Omitted on apply/prove/export hot
   * paths; planning opts in while both raw sides are available. */
  collectSuppression?:
    | ((suppression: ProjectionSuppression) => void)
    | undefined;
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
  const view = resolveView(
    fb,
    opts.policy,
    opts.capability,
    opts.baseline,
    opts.collectSuppression,
  );
  return projectManagementScope(view, scope, {
    ...(opts.defaultOwner !== undefined
      ? { defaultOwner: opts.defaultOwner }
      : {}),
    ...(opts.collectSuppression !== undefined
      ? { collectSuppression: opts.collectSuppression }
      : {}),
  });
}

export interface ProjectionAuditEntry {
  /** Exact raw source↔desired difference hidden by this projection decision. */
  delta: Delta;
  /** Stable state identity, duplicated from `delta` for allowlisting/grouping. */
  subject: ProjectionAuditSubject;
  /** All source/desired projection decisions that hid this subject. */
  suppressions: ProjectionAuditSuppression[];
  /** Suspicious if any side/cause is suspicious; otherwise acknowledged. */
  classification: ProjectionAuditClassification;
}

export interface ProjectionAuditSuppression {
  side: "source" | "desired";
  stage: ProjectionAuditStage;
  reasonCode: string;
  classification: ProjectionAuditClassification;
  viaDescendantOf?: StableId;
}

export interface ProjectionAudit {
  entries: ProjectionAuditEntry[];
  summary: {
    total: number;
    suspicious: number;
    acknowledged: number;
    /** Baseline entries remain separately visible even though acknowledged. */
    baseline: number;
  };
}

function edgeKey(edge: DependencyEdge): string {
  return `${encodeId(edge.from)}|${edge.kind}|${encodeId(edge.to)}`;
}

function subjectKey(subject: ProjectionAuditSubject): string {
  return subject.kind === "fact"
    ? `fact:${encodeId(subject.id)}`
    : `edge:${edgeKey(subject.edge)}`;
}

function deltaSubject(delta: Delta): ProjectionAuditSubject {
  return delta.verb === "link" || delta.verb === "unlink"
    ? { kind: "edge", edge: delta.edge }
    : { kind: "fact", id: subjectOf(delta) };
}

function deltaKey(delta: Delta): string {
  switch (delta.verb) {
    case "add":
    case "remove":
      return `${delta.verb}|${encodeId(delta.fact.id)}`;
    case "set":
      return `${delta.verb}|${encodeId(delta.id)}|${delta.attr}`;
    case "link":
    case "unlink":
      return `${delta.verb}|${edgeKey(delta.edge)}`;
  }
}

/** Compute the attributed audit while both raw fact bases are available.
 *
 * The unit is suppressed delta/state: fact payload, independently-pruned edge,
 * reference-only payload/edge, and managedBy provenance. Suppression traces
 * from either side join directly to the raw source↔desired diff, so a baseline
 * that suppresses only one side remains visible even if managed drift survives.
 */
export function auditManagedViewProjection(
  rawSource: FactBase,
  rawDesired: FactBase,
  opts: ReconstructManagedViewOptions = {},
): ProjectionAudit {
  const suppressions: Array<{
    side: "source" | "desired";
    suppression: ProjectionSuppression;
  }> = [];
  reconstructManagedView(rawSource, {
    ...opts,
    collectSuppression: (suppression) =>
      suppressions.push({ side: "source", suppression }),
  });
  reconstructManagedView(rawDesired, {
    ...opts,
    collectSuppression: (suppression) =>
      suppressions.push({ side: "desired", suppression }),
  });

  const bySubject = new Map<
    string,
    Array<{ side: "source" | "desired"; suppression: ProjectionSuppression }>
  >();
  for (const traced of suppressions) {
    const { suppression } = traced;
    const key = subjectKey(suppression.subject);
    const list = bySubject.get(key) ?? [];
    list.push(traced);
    bySubject.set(key, list);
  }

  const entries: ProjectionAuditEntry[] = [];
  for (const delta of diff(rawSource, rawDesired)) {
    const subject = deltaSubject(delta);
    const entrySuppressions: ProjectionAuditSuppression[] = [];
    const seen = new Set<string>();
    for (const { side, suppression } of bySubject.get(subjectKey(subject)) ??
      []) {
      const via = suppression.viaDescendantOf
        ? encodeId(suppression.viaDescendantOf)
        : "";
      const key = `${side}|${suppression.stage}|${suppression.reasonCode}|${suppression.classification}|${via}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entrySuppressions.push({
        side,
        stage: suppression.stage,
        reasonCode: suppression.reasonCode,
        classification: suppression.classification,
        ...(suppression.viaDescendantOf === undefined
          ? {}
          : { viaDescendantOf: suppression.viaDescendantOf }),
      });
    }
    if (entrySuppressions.length === 0) continue;
    entrySuppressions.sort((a, b) => {
      const aKey = `${a.side}|${a.stage}|${a.reasonCode}|${a.viaDescendantOf ? encodeId(a.viaDescendantOf) : ""}`;
      const bKey = `${b.side}|${b.stage}|${b.reasonCode}|${b.viaDescendantOf ? encodeId(b.viaDescendantOf) : ""}`;
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
    entries.push({
      delta,
      subject,
      suppressions: entrySuppressions,
      classification: entrySuppressions.some(
        (suppression) => suppression.classification === "suspicious",
      )
        ? "suspicious"
        : "acknowledged",
    });
  }
  entries.sort((a, b) => {
    const aKey = deltaKey(a.delta);
    const bKey = deltaKey(b.delta);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });

  return {
    entries,
    summary: {
      total: entries.length,
      suspicious: entries.filter(
        (entry) => entry.classification === "suspicious",
      ).length,
      acknowledged: entries.filter(
        (entry) => entry.classification === "acknowledged",
      ).length,
      baseline: entries.filter((entry) =>
        entry.suppressions.some(
          (suppression) => suppression.stage === "baseline",
        ),
      ).length,
    },
  };
}
