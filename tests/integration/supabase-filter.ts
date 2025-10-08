import type { Catalog } from "../../src/catalog.model.ts";
import type { Change } from "../../src/change.types.ts";

const SUPABASE_SCHEMAS = [
  "auth",
  "extensions",
  "graphql",
  "graphql_public",
  "pgbouncer",
  "pgmq",
  "pgmq_public",
  "realtime",
  "storage",
  "supabase_functions",
  "vault",
];

const SUPABASE_ROLES = [
  "anon",
  "authenticated",
  "authenticator",
  "dashboard_user",
  "pgbouncer",
  "service_role",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_etl_admin",
  "supabase_read_only_user",
  "supabase_realtime_admin",
  "supabase_replication_admin",
  "supabase_storage_admin",
];

function getSchema(change: Change) {
  switch (change.objectType) {
    case "collation":
      return change.collation.schema;
    case "composite_type":
      return change.compositeType.schema;
    case "domain":
      return change.domain.schema;
    case "enum":
      return change.enum.schema;
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
    case "range":
      return change.range.schema;
    case "rls_policy":
      return change.policy.schema;
    case "role":
      return null;
    case "schema":
      return change.schema.name;
    case "sequence":
      return change.sequence.schema;
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

function getOwner(change: Change) {
  switch (change.objectType) {
    case "collation":
      return change.collation.owner;
    case "composite_type":
      return change.compositeType.owner;
    case "domain":
      return change.domain.owner;
    case "enum":
      return change.enum.owner;
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
    case "range":
      return change.range.owner;
    case "rls_policy":
      return change.policy.owner;
    case "role":
      return change.role.name;
    case "schema":
      return change.schema.owner;
    case "sequence":
      return change.sequence.owner;
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

export function supabaseFilter(
  _ctx: { mainCatalog: Catalog; branchCatalog: Catalog },
  changes: Change[],
) {
  return changes.filter((change) => {
    const owner = getOwner(change);
    const schema = getSchema(change);

    // if new extensions are enabled, we need to include them
    if (
      change.objectType === "extension" &&
      change.operation === "create" &&
      change.scope === "object"
    ) {
      return true;
    }

    // if new schemas are created and they are used by extensions, we need to include them
    if (
      change.objectType === "schema" &&
      change.operation === "create" &&
      change.scope === "object"
    ) {
      return true;
    }

    return (
      !SUPABASE_ROLES.includes(owner) &&
      !(
        change.objectType === "role" &&
        change.scope === "membership" &&
        SUPABASE_ROLES.includes(change.member)
      ) &&
      !SUPABASE_SCHEMAS.includes(schema ?? "")
    );
  });
}
