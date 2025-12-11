import type { Change } from "../change.types.ts";
import { DropSequence } from "../objects/sequence/changes/sequence.drop.ts";
import { AlterTableDropColumn } from "../objects/table/changes/table.alter.ts";
import { DropTable } from "../objects/table/changes/table.drop.ts";
import type { PlanRisk, PlanRiskEntry, PlanRiskLevel } from "./types.ts";

export interface PlanRiskSummary extends PlanRisk {}

/**
 * Classify a single change for data-loss risk.
 */
export function classifyChangeRisk(change: Change): PlanRiskEntry | null {
  if (change instanceof DropTable) {
    return {
      changeId: change.changeId,
      reason: `drop table ${change.table.schema}.${change.table.name}`,
      object: `${change.table.schema}.${change.table.name}`,
      sql: change.serialize(),
    };
  }

  if (change instanceof AlterTableDropColumn) {
    return {
      changeId: change.changeId,
      reason: `drop column ${change.column.name} on ${change.table.schema}.${change.table.name}`,
      object: `${change.table.schema}.${change.table.name}.${change.column.name}`,
      sql: change.serialize(),
    };
  }

  if (change instanceof DropSequence) {
    return {
      changeId: change.changeId,
      reason: `drop sequence ${change.sequence.schema}.${change.sequence.name}`,
      object: `${change.sequence.schema}.${change.sequence.name}`,
      sql: change.serialize(),
    };
  }

  // Extend here if TRUNCATE or other data-loss operations are added.
  return null;
}

/**
 * Classify all changes for data-loss risk.
 */
export function classifyChangesRisk(changes: Change[]): PlanRisk {
  const dataLoss: PlanRiskEntry[] = [];

  for (const change of changes) {
    const entry = classifyChangeRisk(change);
    if (entry) dataLoss.push(entry);
  }

  const level: PlanRiskLevel = dataLoss.length > 0 ? "data_loss" : "safe";

  return { level, dataLoss };
}
