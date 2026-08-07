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
import type { PayloadValue } from "../core/hash.ts";
import { encodeId, parseId, type StableId } from "../core/stable-id.ts";
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

const AUDIT_STAGES = new Set<ProjectionAuditStage>([
  "baseline",
  "policyScopeRule",
  "capability",
  "managementScope",
  "referenceOnly",
  "managedBy",
]);
const AUDIT_CLASSIFICATIONS = new Set<ProjectionAuditClassification>([
  "acknowledged",
  "suspicious",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPayloadRecord = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

function invalidAudit(path: string): never {
  throw new Error(`projection audit: invalid ${path}`);
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") invalidAudit(path);
}

function structurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => structurallyEqual(value, b[index]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const comparableKeys = (record: Record<string, unknown>): string[] =>
    Object.keys(record)
      .filter(
        (key) =>
          !(
            record["kind"] === "acl" &&
            key === "column" &&
            record[key] === undefined
          ),
      )
      .sort();
  const aKeys = comparableKeys(a);
  const bKeys = comparableKeys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every(
      (key, index) => key === bKeys[index] && structurallyEqual(a[key], b[key]),
    )
  );
}

function assertPayloadValue(
  value: unknown,
  path: string,
  allowUndefined = false,
): asserts value is PayloadValue {
  if (value === null) return;
  switch (typeof value) {
    case "string":
    case "boolean":
    case "bigint":
      return;
    case "number":
      if (Number.isFinite(value)) return;
      invalidAudit(path);
    case "undefined":
      if (allowUndefined) return;
      invalidAudit(path);
    case "object":
      if (Array.isArray(value)) {
        value.forEach((item, index) =>
          assertPayloadValue(item, `${path}[${index}]`),
        );
        return;
      }
      if (!isPayloadRecord(value)) invalidAudit(path);
      for (const [key, item] of Object.entries(value)) {
        assertPayloadValue(item, `${path}.${key}`, true);
      }
      return;
    default:
      invalidAudit(path);
  }
}

function assertStableId(
  value: unknown,
  path: string,
): asserts value is StableId {
  if (!isRecord(value)) invalidAudit(path);
  try {
    const roundTripped = parseId(encodeId(value as unknown as StableId));
    if (!structurallyEqual(value, roundTripped)) invalidAudit(path);
  } catch {
    invalidAudit(path);
  }
}

function assertEdge(
  value: unknown,
  path: string,
): asserts value is DependencyEdge {
  if (!isRecord(value)) invalidAudit(path);
  assertStableId(value["from"], `${path}.from`);
  assertStableId(value["to"], `${path}.to`);
  if (
    value["kind"] !== "depends" &&
    value["kind"] !== "owner" &&
    value["kind"] !== "memberOfExtension" &&
    value["kind"] !== "managedBy"
  )
    invalidAudit(`${path}.kind`);
}

function assertDelta(value: unknown, path: string): asserts value is Delta {
  if (!isRecord(value)) invalidAudit(path);
  switch (value["verb"]) {
    case "add":
    case "remove": {
      const fact = value["fact"];
      if (!isRecord(fact)) invalidAudit(`${path}.fact`);
      const payload = fact["payload"];
      if (
        typeof payload !== "object" ||
        payload === null ||
        !isPayloadRecord(payload)
      )
        invalidAudit(`${path}.fact.payload`);
      assertStableId(fact["id"], `${path}.fact.id`);
      if (fact["parent"] !== undefined)
        assertStableId(fact["parent"], `${path}.fact.parent`);
      for (const [key, payloadValue] of Object.entries(payload)) {
        assertPayloadValue(payloadValue, `${path}.fact.payload.${key}`, true);
      }
      break;
    }
    case "set":
      assertStableId(value["id"], `${path}.id`);
      assertString(value["attr"], `${path}.attr`);
      if (!Object.hasOwn(value, "from") && !Object.hasOwn(value, "to"))
        invalidAudit(`${path}.from/to`);
      if (Object.hasOwn(value, "from"))
        assertPayloadValue(value["from"], `${path}.from`, true);
      if (Object.hasOwn(value, "to"))
        assertPayloadValue(value["to"], `${path}.to`, true);
      break;
    case "link":
    case "unlink":
      assertEdge(value["edge"], `${path}.edge`);
      break;
    default:
      invalidAudit(`${path}.verb`);
  }
}

/** Validate an audit received across an artifact/API boundary and recompute all
 * cached classifications/counts from its suppression entries. */
export function normalizeProjectionAudit(value: unknown): ProjectionAudit {
  if (!isRecord(value) || !Array.isArray(value["entries"]))
    invalidAudit("root");
  const summary = value["summary"];
  if (!isRecord(summary)) invalidAudit("summary");
  for (const field of ["total", "suspicious", "acknowledged", "baseline"]) {
    const count = summary[field];
    if (!Number.isInteger(count) || (count as number) < 0)
      invalidAudit(`summary.${field}`);
  }

  const entries = value["entries"].map((candidate, index) => {
    const path = `entries[${index}]`;
    if (!isRecord(candidate)) invalidAudit(path);
    assertDelta(candidate["delta"], `${path}.delta`);
    const subject = candidate["subject"];
    if (!isRecord(subject)) invalidAudit(`${path}.subject`);
    if (subject["kind"] === "fact") {
      assertStableId(subject["id"], `${path}.subject.id`);
    } else if (subject["kind"] === "edge") {
      assertEdge(subject["edge"], `${path}.subject.edge`);
    } else {
      invalidAudit(`${path}.subject.kind`);
    }
    const expectedSubject = deltaSubject(candidate["delta"]);
    if (
      subjectKey(subject as ProjectionAuditSubject) !==
      subjectKey(expectedSubject)
    )
      invalidAudit(`${path}.subject`);
    if (!AUDIT_CLASSIFICATIONS.has(candidate["classification"] as never))
      invalidAudit(`${path}.classification`);
    if (
      !Array.isArray(candidate["suppressions"]) ||
      candidate["suppressions"].length === 0
    )
      invalidAudit(`${path}.suppressions`);
    const suppressions = candidate["suppressions"].map(
      (suppression, suppressionIndex) => {
        const suppressionPath = `${path}.suppressions[${suppressionIndex}]`;
        if (!isRecord(suppression)) invalidAudit(suppressionPath);
        if (
          suppression["side"] !== "source" &&
          suppression["side"] !== "desired"
        )
          invalidAudit(`${suppressionPath}.side`);
        if (!AUDIT_STAGES.has(suppression["stage"] as never))
          invalidAudit(`${suppressionPath}.stage`);
        assertString(
          suppression["reasonCode"],
          `${suppressionPath}.reasonCode`,
        );
        if (!AUDIT_CLASSIFICATIONS.has(suppression["classification"] as never))
          invalidAudit(`${suppressionPath}.classification`);
        if (suppression["viaDescendantOf"] !== undefined)
          assertStableId(
            suppression["viaDescendantOf"],
            `${suppressionPath}.viaDescendantOf`,
          );
        return suppression as unknown as ProjectionAuditSuppression;
      },
    );
    const classification: ProjectionAuditClassification = suppressions.some(
      (suppression) => suppression.classification === "suspicious",
    )
      ? "suspicious"
      : "acknowledged";
    return {
      delta: candidate["delta"],
      subject: subject as ProjectionAuditSubject,
      suppressions,
      classification,
    };
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
  const suppressions: TracedSuppression[] = [];
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
  return projectionAuditFrom(rawSource, rawDesired, suppressions);
}

/** A projection suppression tagged with the diff side that produced it. */
export interface TracedSuppression {
  side: "source" | "desired";
  suppression: ProjectionSuppression;
}

/** Freshly allocated each call — `entries` is a mutable array the caller owns. */
const emptyAudit = (): ProjectionAudit => ({
  entries: [],
  summary: { total: 0, suspicious: 0, acknowledged: 0, baseline: 0 },
});

/**
 * Attribute already-collected suppressions to the raw source↔desired diff.
 *
 * Split out of `auditManagedViewProjection` so the planner can reuse the
 * suppressions its OWN managed-view reconstruction already collected instead of
 * reconstructing both sides a second time (`buildChangeSet` → `plan()`), and so
 * the raw diff is skipped entirely when nothing was suppressed.
 */
export function projectionAuditFrom(
  rawSource: FactBase,
  rawDesired: FactBase,
  suppressions: readonly TracedSuppression[],
): ProjectionAudit {
  // Nothing was suppressed ⇒ every delta below would find zero traced
  // suppressions and `continue`, so the audit is empty by construction. Return
  // it without paying for a third full raw diff (the common no-policy path).
  if (suppressions.length === 0) return emptyAudit();

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
    const tracedSuppressions = [
      ...(bySubject.get(subjectKey(subject)) ?? []),
      // diff() suppresses every outgoing edge delta when the edge's FROM fact is
      // reference-only on EITHER side. The edge may exist only on the opposite,
      // non-reference-only side, so no exact edge suppression record exists
      // there. Join the fact-level reference-only decision as the cause or that
      // asymmetric edge drift disappears from the audit entirely.
      ...(subject.kind === "edge"
        ? (
            bySubject.get(
              subjectKey({ kind: "fact", id: subject.edge.from }),
            ) ?? []
          ).filter(({ suppression }) => suppression.stage === "referenceOnly")
        : []),
    ];
    for (const { side, suppression } of tracedSuppressions) {
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
