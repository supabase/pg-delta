import type { Sql } from "postgres";
import { extractDepends, type PgDepend } from "./depend.ts";
import type { BasePgModel, TableLikeObject } from "./objects/base.model.ts";
import {
  type Collation,
  extractCollations,
} from "./objects/collation/collation.model.ts";
import type { Domain } from "./objects/domain/domain.model.ts";
import { extractDomains } from "./objects/domain/domain.model.ts";
import {
  type Extension,
  extractExtensions,
} from "./objects/extension/extension.model.ts";
import { extractIndexes, type Index } from "./objects/index/index.model.ts";
import {
  extractMaterializedViews,
  type MaterializedView,
} from "./objects/materialized-view/materialized-view.model.ts";
import {
  extractProcedures,
  type Procedure,
} from "./objects/procedure/procedure.model.ts";
import {
  extractRlsPolicies,
  type RlsPolicy,
} from "./objects/rls-policy/rls-policy.model.ts";
import { extractRoles, type Role } from "./objects/role/role.model.ts";
import { extractSchemas, type Schema } from "./objects/schema/schema.model.ts";
import {
  extractSequences,
  type Sequence,
} from "./objects/sequence/sequence.model.ts";
import { extractTables, type Table } from "./objects/table/table.model.ts";
import {
  extractTriggers,
  type Trigger,
} from "./objects/trigger/trigger.model.ts";
import {
  type CompositeType,
  extractCompositeTypes,
} from "./objects/type/composite-type/composite-type.model.ts";
import { type Enum, extractEnums } from "./objects/type/enum/enum.model.ts";
import { extractRanges, type Range } from "./objects/type/range/range.model.ts";
import { extractViews, type View } from "./objects/view/view.model.ts";

interface CatalogProps {
  collations: Record<string, Collation>;
  compositeTypes: Record<string, CompositeType>;
  domains: Record<string, Domain>;
  enums: Record<string, Enum>;
  extensions: Record<string, Extension>;
  procedures: Record<string, Procedure>;
  indexes: Record<string, Index>;
  materializedViews: Record<string, MaterializedView>;
  rlsPolicies: Record<string, RlsPolicy>;
  roles: Record<string, Role>;
  schemas: Record<string, Schema>;
  sequences: Record<string, Sequence>;
  tables: Record<string, Table>;
  triggers: Record<string, Trigger>;
  ranges: Record<string, Range>;
  views: Record<string, View>;
  depends: PgDepend[];
  indexableObjects: Record<string, TableLikeObject>;
}

export class Catalog {
  public readonly collations: CatalogProps["collations"];
  public readonly compositeTypes: CatalogProps["compositeTypes"];
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
  public readonly ranges: CatalogProps["ranges"];
  public readonly views: CatalogProps["views"];
  public readonly depends: CatalogProps["depends"];
  public readonly indexableObjects: CatalogProps["indexableObjects"];

  constructor(props: CatalogProps) {
    this.collations = props.collations;
    this.compositeTypes = props.compositeTypes;
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
    this.ranges = props.ranges;
    this.views = props.views;
    this.depends = props.depends;
    this.indexableObjects = props.indexableObjects;
  }
}

export async function extractCatalog(sql: Sql) {
  const [
    collations,
    compositeTypes,
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
    ranges,
    views,
    depends,
  ] = await Promise.all([
    extractCollations(sql).then(listToRecord),
    extractCompositeTypes(sql).then(listToRecord),
    extractDomains(sql).then(listToRecord),
    extractEnums(sql).then(listToRecord),
    extractExtensions(sql).then(listToRecord),
    extractIndexes(sql).then(listToRecord),
    extractMaterializedViews(sql).then(listToRecord),
    extractProcedures(sql).then(listToRecord),
    extractRlsPolicies(sql).then(listToRecord),
    extractRoles(sql).then(listToRecord),
    extractSchemas(sql).then(listToRecord),
    extractSequences(sql).then(listToRecord),
    extractTables(sql).then(listToRecord),
    extractTriggers(sql).then(listToRecord),
    extractRanges(sql).then(listToRecord),
    extractViews(sql).then(listToRecord),
    extractDepends(sql),
  ]);

  const indexableObjects = {
    ...tables,
    ...materializedViews,
  };

  if (process.env.DEBUG) {
    console.log(
      "depends: ",
      JSON.stringify(
        depends.filter(
          (depend) =>
            !depend.dependent_stable_id.includes("information_schema") &&
            !depend.dependent_stable_id.includes("pg_catalog") &&
            !depend.dependent_stable_id.includes("pg_toast") &&
            !depend.dependent_stable_id.includes("language:plpgsql"),
        ),
        null,
        2,
      ),
    );
  }

  return new Catalog({
    collations,
    compositeTypes,
    domains,
    enums,
    extensions,
    procedures,
    indexes,
    materializedViews,
    rlsPolicies,
    roles,
    schemas,
    sequences,
    tables,
    triggers,
    ranges,
    views,
    depends,
    indexableObjects,
  });
}

function listToRecord<T extends BasePgModel>(list: T[]) {
  return Object.fromEntries(list.map((item) => [item.stableId, item]));
}

export function emptyCatalog() {
  return new Catalog({
    collations: {},
    compositeTypes: {},
    domains: {},
    enums: {},
    extensions: {},
    procedures: {},
    indexes: {},
    materializedViews: {},
    rlsPolicies: {},
    roles: {},
    schemas: {},
    sequences: {},
    tables: {},
    triggers: {},
    ranges: {},
    views: {},
    depends: [],
    indexableObjects: {},
  });
}
