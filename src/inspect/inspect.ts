import type { Sql } from "postgres";
import { OBJECT_KIND_PREFIX } from "./constants.ts";
import { inspectCompositeTypes } from "./objects2/composite-types.ts";
import {
  inspectCollations,
  inspectConstraints,
  inspectDomains,
  inspectEnums,
  inspectExtensions,
  inspectFunctions,
  inspectIndexes,
  inspectMaterializedViews,
  inspectPrivileges,
  inspectRlsPolicies,
  inspectSchemas,
  inspectSequences,
  inspectTables,
  inspectTriggers,
  inspectTypes,
  inspectViews,
} from "./objects2/index.ts";
import type { InspectionMap } from "./types.ts";

export async function inspect(sql: Sql): Promise<InspectionMap> {
  const [
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
  ] = await Promise.all([
    inspectCollations(sql),
    inspectCompositeTypes(sql),
    inspectConstraints(sql),
    inspectDomains(sql),
    inspectEnums(sql),
    inspectExtensions(sql),
    inspectFunctions(sql),
    inspectIndexes(sql),
    inspectMaterializedViews(sql),
    inspectPrivileges(sql),
    inspectRlsPolicies(sql),
    inspectSchemas(sql),
    inspectSequences(sql),
    inspectTables(sql),
    inspectTriggers(sql),
    inspectTypes(sql),
    inspectViews(sql),
  ]);

  const inspection = {
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

  const inspectionMap = {} as InspectionMap;

  for (const [mapName, map] of Object.entries(inspection)) {
    const prefix =
      OBJECT_KIND_PREFIX[mapName as keyof typeof OBJECT_KIND_PREFIX];
    for (const [key, value] of map.entries()) {
      inspectionMap[`${prefix}:${key}`] = value as any;
    }
  }

  return inspectionMap;
}
