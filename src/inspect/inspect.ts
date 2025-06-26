import type { Sql } from "postgres";
import {
  type InspectedCollation,
  type InspectedConstraint,
  type InspectedDomain,
  type InspectedEnum,
  type InspectedExtension,
  type InspectedFunction,
  type InspectedIndex,
  type InspectedPrivilege,
  type InspectedRelations,
  type InspectedRlsPolicy,
  type InspectedSchema,
  type InspectedSequence,
  type InspectedTrigger,
  type InspectedType,
  inspectCollations,
  inspectConstraints,
  inspectDomains,
  inspectEnums,
  inspectExtensions,
  inspectFunctions,
  inspectIndexes,
  inspectPrivileges,
  inspectRelations,
  inspectRlsPolicies,
  inspectSchemas,
  inspectSequences,
  inspectTriggers,
  inspectTypes,
} from "./objects2/index.ts";

export type InspectionResult = {
  collations: InspectedCollation[];
  compositeTypes: InspectedRelations["compositeTypes"];
  constraints: InspectedConstraint[];
  domains: InspectedDomain[];
  enums: InspectedEnum[];
  extensions: InspectedExtension[];
  functions: InspectedFunction[];
  indexes: InspectedIndex[];
  materializedViews: InspectedRelations["materializedViews"];
  privileges: InspectedPrivilege[];
  rlsPolicies: InspectedRlsPolicy[];
  schemas: InspectedSchema[];
  sequences: InspectedSequence[];
  tables: InspectedRelations["tables"];
  triggers: InspectedTrigger[];
  types: InspectedType[];
  views: InspectedRelations["views"];
};

export async function inspect(sql: Sql): Promise<InspectionResult> {
  const [
    collations,
    constraints,
    domains,
    enums,
    extensions,
    functions,
    indexes,
    privileges,
    { compositeTypes, materializedViews, tables, views },
    rlsPolicies,
    schemas,
    sequences,
    triggers,
    types,
  ] = await Promise.all([
    inspectCollations(sql),
    inspectConstraints(sql),
    inspectDomains(sql),
    inspectEnums(sql),
    inspectExtensions(sql),
    inspectFunctions(sql),
    inspectIndexes(sql),
    inspectPrivileges(sql),
    inspectRelations(sql),
    inspectRlsPolicies(sql),
    inspectSchemas(sql),
    inspectSequences(sql),
    inspectTriggers(sql),
    inspectTypes(sql),
  ]);

  return {
    collations,
    compositeTypes,
    constraints,
    domains,
    enums,
    extensions,
    functions,
    indexes,
    materializedViews,
    privileges,
    rlsPolicies,
    schemas,
    sequences,
    tables,
    triggers,
    types,
    views,
  };
}
