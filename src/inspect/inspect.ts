import type { Sql } from "postgres";
import {
  type InspectedCollation,
  inspectCollations,
} from "./objects/collations.ts";
import {
  type InspectedConstraint,
  inspectConstraints,
} from "./objects/constraints.ts";
import { type InspectedDomain, inspectDomains } from "./objects/domains.ts";
import { type InspectedEnum, inspectEnums } from "./objects/enums.ts";
import {
  type InspectedExtension,
  inspectExtensions,
} from "./objects/extensions.ts";
import {
  type InspectedFunction,
  inspectFunctions,
} from "./objects/functions.ts";
import { type InspectedIndex, inspectIndexes } from "./objects/indexes.ts";
import {
  type InspectedPrivilege,
  inspectPrivileges,
} from "./objects/privileges.ts";
import {
  type InspectedRelations,
  inspectRelations,
} from "./objects/relations/relations.ts";
import {
  type InspectedRLSPolicy,
  inspectRLSPolicies,
} from "./objects/rls-policies.ts";
import { type InspectedSchema, inspectSchemas } from "./objects/schemas.ts";
import {
  type InspectedSequence,
  inspectSequences,
} from "./objects/sequences.ts";
import { type InspectedTrigger, inspectTriggers } from "./objects/triggers.ts";
import { type InspectedType, inspectTypes } from "./objects/types.ts";

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
  rlsPolicies: InspectedRLSPolicy[];
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
    inspectRLSPolicies(sql),
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
