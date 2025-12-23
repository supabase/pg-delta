import crypto from "node:crypto";
import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import type { BasePgModel } from "./objects/base.model.ts";

/**
 * Build a deterministic fingerprint for the objects actually touched by a plan.
 * Uses the stableIds declared by the changes (creates/requires/drops) and snapshots
 * only the catalog entities that exist for those stableIds (parent objects, no virtuals).
 */
export function buildPlanScopeFingerprint(
  catalog: Catalog,
  changes: Change[],
): { hash: string; stableIds: string[] } {
  const stableIds = collectStableIds(changes);
  const hash = hashStableIds(catalog, stableIds);
  return { hash, stableIds };
}

/**
 * Compute a fingerprint from a catalog and a set of stableIds.
 */
export function hashStableIds(catalog: Catalog, stableIds: string[]): string {
  const catalogLookup = buildCatalogLookup(catalog);

  const projection: Array<{
    stableId: string;
    snapshot: { identity: unknown; data: unknown };
  }> = [];

  for (const stableId of stableIds) {
    const record = catalogLookup[stableId];
    if (!record) {
      continue;
    }
    projection.push({
      stableId,
      snapshot: record.stableSnapshot(),
    });
  }

  const canonical = stableStringify(projection);
  return sha256(canonical);
}

/**
 * Hash a string to hex SHA256.
 */
function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Collect the union of stableIds referenced by all changes.
 */
function collectStableIds(changes: Change[]): string[] {
  const ids = new Set<string>();

  for (const change of changes) {
    for (const id of getChangeStableIds(change)) {
      ids.add(id);
    }
  }

  return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

/**
 * Gather the stableIds a change touches (creates/requires/drops) and, when the
 * change has a primary entity with a stableId, include it as well.
 */
function getChangeStableIds(change: Change): string[] {
  const ids: string[] = [];

  // Dependencies declared on the change.
  ids.push(...change.creates, ...change.requires, ...change.drops);

  // Best-effort primary entity stableId, when available.
  const primary = getPrimaryStableId(change);
  if (primary) ids.push(primary);

  return ids;
}

/**
 * Extract the primary entity stableId for a change, when it exists.
 */
function getPrimaryStableId(change: Change): string | null {
  switch (change.objectType) {
    case "aggregate":
      return change.aggregate.stableId;
    case "collation":
      return change.collation.stableId;
    case "composite_type":
      return change.compositeType.stableId;
    case "domain":
      return change.domain.stableId;
    case "enum":
      return change.enum.stableId;
    case "event_trigger":
      return change.eventTrigger.stableId;
    case "extension":
      return change.extension.stableId;
    case "foreign_data_wrapper":
      return change.foreignDataWrapper.stableId;
    case "foreign_table":
      return change.foreignTable.stableId;
    case "index":
      return change.index.stableId;
    case "language":
      return change.language.stableId;
    case "materialized_view":
      return change.materializedView.stableId;
    case "procedure":
      return change.procedure.stableId;
    case "publication":
      return change.publication.stableId;
    case "range":
      return change.range.stableId;
    case "role":
      return change.role.stableId;
    case "schema":
      return change.schema.stableId;
    case "sequence":
      return change.sequence.stableId;
    case "server":
      return change.server.stableId;
    case "subscription":
      return change.subscription.stableId;
    case "table":
      return change.table.stableId;
    case "trigger":
      return change.trigger.stableId;
    case "rls_policy":
      return change.policy.stableId;
    case "rule":
      return change.rule.stableId;
    case "view":
      return change.view.stableId;
    case "user_mapping":
      return change.userMapping.stableId;
    default:
      return null;
  }
}

/**
 * Build a flat lookup of catalog objects keyed by stableId.
 */
function buildCatalogLookup(catalog: Catalog): Record<string, BasePgModel> {
  return {
    ...catalog.aggregates,
    ...catalog.collations,
    ...catalog.compositeTypes,
    ...catalog.domains,
    ...catalog.enums,
    ...catalog.extensions,
    ...catalog.procedures,
    ...catalog.indexes,
    ...catalog.materializedViews,
    ...catalog.subscriptions,
    ...catalog.publications,
    ...catalog.rlsPolicies,
    ...catalog.roles,
    ...catalog.schemas,
    ...catalog.sequences,
    ...catalog.tables,
    ...catalog.triggers,
    ...catalog.eventTriggers,
    ...catalog.rules,
    ...catalog.ranges,
    ...catalog.views,
    ...catalog.foreignDataWrappers,
    ...catalog.servers,
    ...catalog.userMappings,
    ...catalog.foreignTables,
  };
}

/**
 * Deterministic stringify with sorted object keys.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") {
      return JSON.stringify(value.toString());
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );

  const inner = entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",");

  return `{${inner}}`;
}
