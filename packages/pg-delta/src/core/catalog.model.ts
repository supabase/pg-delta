import type { Pool } from "pg";
import { extractCurrentUser, extractVersion } from "./context.ts";
import { extractDepends, type PgDepend } from "./depend.ts";
import {
  type Aggregate,
  extractAggregates,
} from "./objects/aggregate/aggregate.model.ts";
import type { BasePgModel, TableLikeObject } from "./objects/base.model.ts";
import {
  type Collation,
  extractCollations,
} from "./objects/collation/collation.model.ts";
import type { Domain } from "./objects/domain/domain.model.ts";
import { extractDomains } from "./objects/domain/domain.model.ts";
import {
  type EventTrigger,
  extractEventTriggers,
} from "./objects/event-trigger/event-trigger.model.ts";
import {
  type Extension,
  extractExtensions,
} from "./objects/extension/extension.model.ts";
import {
  extractForeignDataWrappers,
  ForeignDataWrapper,
} from "./objects/foreign-data-wrapper/foreign-data-wrapper/foreign-data-wrapper.model.ts";
import {
  extractForeignTables,
  ForeignTable,
} from "./objects/foreign-data-wrapper/foreign-table/foreign-table.model.ts";
import { redactSensitiveOptionPairs } from "./objects/foreign-data-wrapper/sensitive-options.ts";
import {
  extractServers,
  Server,
} from "./objects/foreign-data-wrapper/server/server.model.ts";
import {
  extractUserMappings,
  UserMapping,
} from "./objects/foreign-data-wrapper/user-mapping/user-mapping.model.ts";
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
  extractPublications,
  type Publication,
} from "./objects/publication/publication.model.ts";
import {
  extractRlsPolicies,
  type RlsPolicy,
} from "./objects/rls-policy/rls-policy.model.ts";
import { extractRoles, type Role } from "./objects/role/role.model.ts";
import { extractRules, type Rule } from "./objects/rule/rule.model.ts";
import { extractSchemas, Schema } from "./objects/schema/schema.model.ts";
import {
  extractSequences,
  type Sequence,
} from "./objects/sequence/sequence.model.ts";
import {
  extractSubscriptions,
  Subscription,
  SUBSCRIPTION_CONNINFO_PLACEHOLDER,
} from "./objects/subscription/subscription.model.ts";
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
  aggregates: Record<string, Aggregate>;
  collations: Record<string, Collation>;
  compositeTypes: Record<string, CompositeType>;
  domains: Record<string, Domain>;
  enums: Record<string, Enum>;
  extensions: Record<string, Extension>;
  procedures: Record<string, Procedure>;
  indexes: Record<string, Index>;
  materializedViews: Record<string, MaterializedView>;
  subscriptions: Record<string, Subscription>;
  publications: Record<string, Publication>;
  rlsPolicies: Record<string, RlsPolicy>;
  roles: Record<string, Role>;
  schemas: Record<string, Schema>;
  sequences: Record<string, Sequence>;
  tables: Record<string, Table>;
  triggers: Record<string, Trigger>;
  eventTriggers: Record<string, EventTrigger>;
  rules: Record<string, Rule>;
  ranges: Record<string, Range>;
  views: Record<string, View>;
  foreignDataWrappers: Record<string, ForeignDataWrapper>;
  servers: Record<string, Server>;
  userMappings: Record<string, UserMapping>;
  foreignTables: Record<string, ForeignTable>;
  depends: PgDepend[];
  indexableObjects: Record<string, TableLikeObject>;
  version: number;
  currentUser: string;
}

export class Catalog {
  public readonly aggregates: CatalogProps["aggregates"];
  public readonly collations: CatalogProps["collations"];
  public readonly compositeTypes: CatalogProps["compositeTypes"];
  public readonly domains: CatalogProps["domains"];
  public readonly enums: CatalogProps["enums"];
  public readonly extensions: CatalogProps["extensions"];
  public readonly procedures: CatalogProps["procedures"];
  public readonly indexes: CatalogProps["indexes"];
  public readonly materializedViews: CatalogProps["materializedViews"];
  public readonly subscriptions: CatalogProps["subscriptions"];
  public readonly publications: CatalogProps["publications"];
  public readonly rlsPolicies: CatalogProps["rlsPolicies"];
  public readonly roles: CatalogProps["roles"];
  public readonly schemas: CatalogProps["schemas"];
  public readonly sequences: CatalogProps["sequences"];
  public readonly tables: CatalogProps["tables"];
  public readonly triggers: CatalogProps["triggers"];
  public readonly eventTriggers: CatalogProps["eventTriggers"];
  public readonly rules: CatalogProps["rules"];
  public readonly ranges: CatalogProps["ranges"];
  public readonly views: CatalogProps["views"];
  public readonly foreignDataWrappers: CatalogProps["foreignDataWrappers"];
  public readonly servers: CatalogProps["servers"];
  public readonly userMappings: CatalogProps["userMappings"];
  public readonly foreignTables: CatalogProps["foreignTables"];
  public readonly depends: CatalogProps["depends"];
  public readonly indexableObjects: CatalogProps["indexableObjects"];
  public readonly version: CatalogProps["version"];
  public readonly currentUser: CatalogProps["currentUser"];

  constructor(props: CatalogProps) {
    this.aggregates = props.aggregates;
    this.collations = props.collations;
    this.compositeTypes = props.compositeTypes;
    this.domains = props.domains;
    this.enums = props.enums;
    this.extensions = props.extensions;
    this.procedures = props.procedures;
    this.indexes = props.indexes;
    this.materializedViews = props.materializedViews;
    this.subscriptions = props.subscriptions;
    this.publications = props.publications;
    this.rlsPolicies = props.rlsPolicies;
    this.roles = props.roles;
    this.schemas = props.schemas;
    this.sequences = props.sequences;
    this.tables = props.tables;
    this.triggers = props.triggers;
    this.eventTriggers = props.eventTriggers;
    this.rules = props.rules;
    this.ranges = props.ranges;
    this.views = props.views;
    this.foreignDataWrappers = props.foreignDataWrappers;
    this.servers = props.servers;
    this.userMappings = props.userMappings;
    this.foreignTables = props.foreignTables;
    this.depends = props.depends;
    this.indexableObjects = props.indexableObjects;
    this.version = props.version;
    this.currentUser = props.currentUser;
  }
}

// Lazily cached deserialized baselines (shared across calls)
let _pg1516Baseline: Catalog | null = null;
let _pg17Baseline: Catalog | null = null;

async function loadBaselineJson(): Promise<Record<string, unknown>> {
  const mod = await import(
    "./fixtures/empty-catalogs/postgres-15-16-baseline.json",
    { with: { type: "json" } }
  );
  return mod.default as Record<string, unknown>;
}

async function getPg1516Baseline(): Promise<Catalog> {
  if (!_pg1516Baseline) {
    const { deserializeCatalog } = await import("./catalog.snapshot.ts");
    const json = await loadBaselineJson();
    _pg1516Baseline = deserializeCatalog(json);
  }
  return _pg1516Baseline;
}

async function getPg17Baseline(): Promise<Catalog> {
  if (!_pg17Baseline) {
    const { deserializeCatalog } = await import("./catalog.snapshot.ts");
    // PG 17 is identical to PG 15-16 except for a single addition:
    // the MAINTAIN privilege on default relation (objtype "r") privileges.
    // We patch the 15-16 baseline to avoid shipping a second full JSON file.
    const json = await loadBaselineJson();
    const patched = structuredClone(json);
    const roles = patched.roles as
      | Record<string, Record<string, unknown>>
      | undefined;
    const pgRole = roles?.["role:postgres"];
    if (pgRole) {
      const defaultPrivileges = pgRole.default_privileges as Array<{
        objtype: string;
        grantee: string;
        privileges: Array<{ privilege: string; grantable: boolean }>;
      }>;
      const relPrivs = defaultPrivileges?.find(
        (dp) => dp.objtype === "r" && dp.grantee === "postgres",
      );
      if (relPrivs) {
        const insertIdx = relPrivs.privileges.findIndex(
          (p) => p.privilege === "INSERT",
        );
        if (insertIdx === -1) {
          throw new Error(
            "PG17 baseline patch failed: INSERT privilege not found in default relation privileges",
          );
        }
        relPrivs.privileges.splice(insertIdx + 1, 0, {
          privilege: "MAINTAIN",
          grantable: false,
        });
      }
    }
    _pg17Baseline = deserializeCatalog(patched);
  }
  return _pg17Baseline;
}

/**
 * Create a baseline catalog representing a fresh PostgreSQL database.
 *
 * For PG 15+ this deserializes a pre-extracted snapshot of an empty `template1`
 * database, including the `plpgsql` extension, `postgres` role with default
 * privileges, and the `public` schema with its default ACLs and depends.
 *
 * For PG < 15, falls back to a minimal inline catalog with only the `public`
 * schema. For exact fidelity on older versions, snapshot a real reference
 * database using `serializeCatalog` and pass the deserialized result as source
 * to `createPlan`.
 */
export async function createEmptyCatalog(
  version: number,
  currentUser: string,
): Promise<Catalog> {
  if (version >= 170000) {
    const baseline = await getPg17Baseline();
    // oxlint-disable-next-line typescript/no-misused-spread
    return new Catalog({ ...baseline, version, currentUser });
  }
  if (version >= 150000) {
    const baseline = await getPg1516Baseline();
    // oxlint-disable-next-line typescript/no-misused-spread
    return new Catalog({ ...baseline, version, currentUser });
  }

  const publicSchema = new Schema({
    name: "public",
    owner: currentUser,
    comment: "standard public schema",
    privileges: [],
    security_labels: [],
  });

  return new Catalog({
    aggregates: {},
    collations: {},
    compositeTypes: {},
    domains: {},
    enums: {},
    extensions: {},
    procedures: {},
    indexes: {},
    materializedViews: {},
    subscriptions: {},
    publications: {},
    rlsPolicies: {},
    roles: {},
    schemas: { [publicSchema.stableId]: publicSchema },
    sequences: {},
    tables: {},
    triggers: {},
    eventTriggers: {},
    rules: {},
    ranges: {},
    views: {},
    foreignDataWrappers: {},
    servers: {},
    userMappings: {},
    foreignTables: {},
    depends: [],
    indexableObjects: {},
    version,
    currentUser,
  });
}

interface ExtractCatalogOptions {
  /**
   * Number of retry attempts for catalog extractors when `pg_get_*def()`
   * returns NULL for at least one row. See `ExtractRetryOptions.retries`.
   */
  extractRetries?: number;
}

export async function extractCatalog(
  pool: Pool,
  options: ExtractCatalogOptions = {},
) {
  const retryOptions = { retries: options.extractRetries };
  const [
    aggregates,
    collations,
    compositeTypes,
    domains,
    enums,
    extensions,
    indexes,
    materializedViews,
    subscriptions,
    publications,
    procedures,
    rlsPolicies,
    roles,
    schemas,
    sequences,
    tables,
    triggers,
    eventTriggers,
    rules,
    ranges,
    views,
    foreignDataWrappers,
    servers,
    userMappings,
    foreignTables,
    depends,
    version,
    currentUser,
  ] = await Promise.all([
    extractAggregates(pool).then(listToRecord),
    extractCollations(pool).then(listToRecord),
    extractCompositeTypes(pool).then(listToRecord),
    extractDomains(pool).then(listToRecord),
    extractEnums(pool).then(listToRecord),
    extractExtensions(pool).then(listToRecord),
    extractIndexes(pool, retryOptions).then(listToRecord),
    extractMaterializedViews(pool, retryOptions).then(listToRecord),
    extractSubscriptions(pool).then(listToRecord),
    extractPublications(pool).then(listToRecord),
    extractProcedures(pool, retryOptions).then(listToRecord),
    extractRlsPolicies(pool).then(listToRecord),
    extractRoles(pool).then(listToRecord),
    extractSchemas(pool).then(listToRecord),
    extractSequences(pool).then(listToRecord),
    extractTables(pool, retryOptions).then(listToRecord),
    extractTriggers(pool, retryOptions).then(listToRecord),
    extractEventTriggers(pool).then(listToRecord),
    extractRules(pool, retryOptions).then(listToRecord),
    extractRanges(pool).then(listToRecord),
    extractViews(pool, retryOptions).then(listToRecord),
    extractForeignDataWrappers(pool).then(listToRecord),
    extractServers(pool).then(listToRecord),
    extractUserMappings(pool).then(listToRecord),
    extractForeignTables(pool).then(listToRecord),
    extractDepends(pool),
    extractVersion(pool),
    extractCurrentUser(pool),
  ]);

  const indexableObjects = {
    ...tables,
    ...materializedViews,
  };

  const catalog = new Catalog({
    aggregates,
    collations,
    compositeTypes,
    domains,
    enums,
    extensions,
    procedures,
    indexes,
    materializedViews,
    subscriptions,
    publications,
    rlsPolicies,
    roles,
    schemas,
    sequences,
    tables,
    triggers,
    eventTriggers,
    rules,
    ranges,
    views,
    foreignDataWrappers,
    servers,
    userMappings,
    foreignTables,
    depends,
    indexableObjects,
    version,
    currentUser,
  });

  return normalizeCatalog(catalog);
}

function listToRecord<T extends BasePgModel>(list: T[]) {
  return Object.fromEntries(list.map((item) => [item.stableId, item]));
}

function normalizeCatalog(catalog: Catalog): Catalog {
  const foreignDataWrappers = mapRecord(
    catalog.foreignDataWrappers,
    (fdw) =>
      new ForeignDataWrapper({
        name: fdw.name,
        owner: fdw.owner,
        handler: fdw.handler,
        validator: fdw.validator,
        options: redactSensitiveOptionPairs(fdw.options),
        comment: fdw.comment,
        privileges: fdw.privileges,
      }),
  );

  const servers = mapRecord(catalog.servers, (server) => {
    return new Server({
      name: server.name,
      owner: server.owner,
      foreign_data_wrapper: server.foreign_data_wrapper,
      type: server.type,
      version: server.version,
      options: redactSensitiveOptionPairs(server.options),
      comment: server.comment,
      privileges: server.privileges,
      wrapper_handler: server.wrapper_handler,
      wrapper_validator: server.wrapper_validator,
    });
  });

  const userMappings = mapRecord(catalog.userMappings, (mapping) => {
    return new UserMapping({
      user: mapping.user,
      server: mapping.server,
      options: redactSensitiveOptionPairs(mapping.options),
      wrapper_handler: mapping.wrapper_handler,
      wrapper_validator: mapping.wrapper_validator,
    });
  });

  const foreignTables = mapRecord(
    catalog.foreignTables,
    (foreignTable) =>
      new ForeignTable({
        schema: foreignTable.schema,
        name: foreignTable.name,
        owner: foreignTable.owner,
        server: foreignTable.server,
        columns: foreignTable.columns,
        options: redactSensitiveOptionPairs(foreignTable.options),
        comment: foreignTable.comment,
        privileges: foreignTable.privileges,
        wrapper_handler: foreignTable.wrapper_handler,
        wrapper_validator: foreignTable.wrapper_validator,
      }),
  );

  const subscriptions = mapRecord(catalog.subscriptions, (subscription) => {
    return new Subscription({
      name: subscription.name,
      raw_name: subscription.raw_name,
      owner: subscription.owner,
      comment: subscription.comment,
      enabled: subscription.enabled,
      binary: subscription.binary,
      streaming: subscription.streaming,
      two_phase: subscription.two_phase,
      disable_on_error: subscription.disable_on_error,
      password_required: subscription.password_required,
      run_as_owner: subscription.run_as_owner,
      failover: subscription.failover,
      conninfo: SUBSCRIPTION_CONNINFO_PLACEHOLDER,
      slot_name: subscription.slot_name,
      slot_is_none: subscription.slot_is_none,
      replication_slot_created: subscription.replication_slot_created,
      synchronous_commit: subscription.synchronous_commit,
      publications: subscription.publications,
      origin: subscription.origin,
    });
  });

  return new Catalog({
    aggregates: catalog.aggregates,
    collations: catalog.collations,
    compositeTypes: catalog.compositeTypes,
    domains: catalog.domains,
    enums: catalog.enums,
    extensions: catalog.extensions,
    procedures: catalog.procedures,
    indexes: catalog.indexes,
    materializedViews: catalog.materializedViews,
    subscriptions,
    publications: catalog.publications,
    rlsPolicies: catalog.rlsPolicies,
    roles: catalog.roles,
    schemas: catalog.schemas,
    sequences: catalog.sequences,
    tables: catalog.tables,
    triggers: catalog.triggers,
    eventTriggers: catalog.eventTriggers,
    rules: catalog.rules,
    ranges: catalog.ranges,
    views: catalog.views,
    foreignDataWrappers,
    servers,
    userMappings,
    foreignTables,
    depends: catalog.depends,
    indexableObjects: catalog.indexableObjects,
    version: catalog.version,
    currentUser: catalog.currentUser,
  });
}

function mapRecord<TValue, TResult>(
  record: Record<string, TValue>,
  mapper: (value: TValue) => TResult,
): Record<string, TResult> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, mapper(value)]),
  );
}
