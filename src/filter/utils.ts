import type { Change } from "../change.types.ts";

export function getSchema(change: Change) {
  switch (change.objectType) {
    case "aggregate":
      return change.aggregate.schema;
    case "collation":
      return change.collation.schema;
    case "composite_type":
      return change.compositeType.schema;
    case "domain":
      return change.domain.schema;
    case "enum":
      return change.enum.schema;
    case "event_trigger":
      return null;
    case "extension":
      return change.extension.schema;
    case "index":
      return change.index.schema;
    case "language":
      return null;
    case "materialized_view":
      return change.materializedView.schema;
    case "procedure":
      return change.procedure.schema;
    case "publication":
      return null;
    case "range":
      return change.range.schema;
    case "rls_policy":
      return change.policy.schema;
    case "role":
      return null;
    case "rule":
      return change.rule.schema;
    case "schema":
      return change.schema.name;
    case "sequence":
      return change.sequence.schema;
    case "subscription":
      return null;
    case "table":
      return change.table.schema;
    case "trigger":
      return change.trigger.schema;
    case "view":
      return change.view.schema;
    default: {
      // exhaustiveness check
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}

export function getOwner(change: Change) {
  switch (change.objectType) {
    case "aggregate":
      return change.aggregate.owner;
    case "collation":
      return change.collation.owner;
    case "composite_type":
      return change.compositeType.owner;
    case "domain":
      return change.domain.owner;
    case "enum":
      return change.enum.owner;
    case "event_trigger":
      return change.eventTrigger.owner;
    case "extension":
      return change.extension.owner;
    case "index":
      return change.index.owner;
    case "language":
      return change.language.owner;
    case "materialized_view":
      return change.materializedView.owner;
    case "procedure":
      return change.procedure.owner;
    case "publication":
      return change.publication.owner;
    case "range":
      return change.range.owner;
    case "rls_policy":
      return change.policy.owner;
    case "role":
      return change.role.name;
    case "rule":
      return change.rule.owner;
    case "schema":
      return change.schema.owner;
    case "sequence":
      return change.sequence.owner;
    case "subscription":
      return change.subscription.owner;
    case "table":
      return change.table.owner;
    case "trigger":
      return change.trigger.owner;
    case "view":
      return change.view.owner;
    default: {
      // exhaustiveness check
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}
