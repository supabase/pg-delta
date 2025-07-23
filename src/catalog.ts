import type { Sql } from "postgres";
import { type Collation, extractCollations } from "./models/collation.ts";
import {
  type CompositeType,
  extractCompositeTypes,
} from "./models/composite-type.ts";
import { type Constraint, extractConstraints } from "./models/constraint.ts";
import { type Domain, extractDomains } from "./models/domain.ts";
import { type Enum, extractEnums } from "./models/enum.ts";
import { type Extension, extractExtensions } from "./models/extension.ts";
import { extractIndexes, type Index } from "./models/index.ts";
import {
  extractMaterializedViews,
  type MaterializedView,
} from "./models/materialized-view.ts";
import { extractProcedures, type Procedure } from "./models/procedure.ts";
import { extractRlsPolicies, type RlsPolicy } from "./models/rls-policy.ts";
import { extractRoles, type Role } from "./models/role.ts";
import { extractSchemas, type Schema } from "./models/schema.ts";
import { extractSequences, type Sequence } from "./models/sequence.ts";
import { extractTables, type Table } from "./models/table.ts";
import { extractTriggers, type Trigger } from "./models/trigger.ts";
import { extractTypes, type Type } from "./models/type.ts";
import { extractViews, type View } from "./models/view.ts";

interface CatalogProps {
  collations: Collation[];
  compositeTypes: CompositeType[];
  constraints: Constraint[];
  domains: Domain[];
  enums: Enum[];
  extensions: Extension[];
  procedures: Procedure[];
  indexes: Index[];
  materializedViews: MaterializedView[];
  rlsPolicies: RlsPolicy[];
  roles: Role[];
  schemas: Schema[];
  sequences: Sequence[];
  tables: Table[];
  triggers: Trigger[];
  types: Type[];
  views: View[];
}

export class Catalog {
  public readonly collations: CatalogProps["collations"];
  public readonly compositeTypes: CatalogProps["compositeTypes"];
  public readonly constraints: CatalogProps["constraints"];
  public readonly domains: CatalogProps["domains"];
  public readonly enums: CatalogProps["enums"];
  public readonly extensions: CatalogProps["extensions"];
  public readonly procedures: CatalogProps["procedures"];
  public readonly indexes: CatalogProps["indexes"];
  public readonly materializedViews: CatalogProps["materializedViews"];
  public readonly rlsPolicies: CatalogProps["rlsPolicies"];
  public readonly roles: CatalogProps["roles"];
  public readonly schemas: CatalogProps["schemas"];
  public readonly sequences: CatalogProps["sequences"];
  public readonly tables: CatalogProps["tables"];
  public readonly triggers: CatalogProps["triggers"];
  public readonly types: CatalogProps["types"];
  public readonly views: CatalogProps["views"];

  constructor(props: CatalogProps) {
    this.collations = props.collations;
    this.compositeTypes = props.compositeTypes;
    this.constraints = props.constraints;
    this.domains = props.domains;
    this.enums = props.enums;
    this.extensions = props.extensions;
    this.procedures = props.procedures;
    this.indexes = props.indexes;
    this.materializedViews = props.materializedViews;
    this.rlsPolicies = props.rlsPolicies;
    this.roles = props.roles;
    this.schemas = props.schemas;
    this.sequences = props.sequences;
    this.tables = props.tables;
    this.triggers = props.triggers;
    this.types = props.types;
    this.views = props.views;
  }
}

export async function extractCatalog(sql: Sql) {
  const [
    collations,
    compositeTypes,
    constraints,
    domains,
    enums,
    extensions,
    indexes,
    materializedViews,
    procedures,
    rlsPolicies,
    roles,
    schemas,
    sequences,
    tables,
    triggers,
    types,
    views,
  ] = await Promise.all([
    extractCollations(sql),
    extractCompositeTypes(sql),
    extractConstraints(sql),
    extractDomains(sql),
    extractEnums(sql),
    extractExtensions(sql),
    extractIndexes(sql),
    extractMaterializedViews(sql),
    extractProcedures(sql),
    extractRlsPolicies(sql),
    extractRoles(sql),
    extractSchemas(sql),
    extractSequences(sql),
    extractTables(sql),
    extractTriggers(sql),
    extractTypes(sql),
    extractViews(sql),
  ]);

  return new Catalog({
    collations,
    compositeTypes,
    constraints,
    domains,
    enums,
    extensions,
    indexes,
    materializedViews,
    procedures,
    rlsPolicies,
    roles,
    schemas,
    sequences,
    tables,
    triggers,
    types,
    views,
  });
}
