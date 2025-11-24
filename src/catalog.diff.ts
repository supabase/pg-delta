import { DEBUG } from "../tests/constants.ts";
import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { diffAggregates } from "./objects/aggregate/aggregate.diff.ts";
import { DefaultPrivilegeState } from "./objects/base.default-privileges.ts";
import { diffCollations } from "./objects/collation/collation.diff.ts";
import { diffDomains } from "./objects/domain/domain.diff.ts";
import { diffEventTriggers } from "./objects/event-trigger/event-trigger.diff.ts";
import { diffExtensions } from "./objects/extension/extension.diff.ts";
import { diffForeignDataWrappers } from "./objects/foreign-data-wrapper/foreign-data-wrapper/foreign-data-wrapper.diff.ts";
import { diffForeignTables } from "./objects/foreign-data-wrapper/foreign-table/foreign-table.diff.ts";
import { diffServers } from "./objects/foreign-data-wrapper/server/server.diff.ts";
import { diffUserMappings } from "./objects/foreign-data-wrapper/user-mapping/user-mapping.diff.ts";
import { diffIndexes } from "./objects/index/index.diff.ts";
import { diffMaterializedViews } from "./objects/materialized-view/materialized-view.diff.ts";
import { diffProcedures } from "./objects/procedure/procedure.diff.ts";
import { diffPublications } from "./objects/publication/publication.diff.ts";
import { diffRlsPolicies } from "./objects/rls-policy/rls-policy.diff.ts";
import {
  GrantRoleDefaultPrivileges,
  RevokeRoleDefaultPrivileges,
} from "./objects/role/changes/role.privilege.ts";
import { diffRoles } from "./objects/role/role.diff.ts";
import { diffRules } from "./objects/rule/rule.diff.ts";
import { diffSchemas } from "./objects/schema/schema.diff.ts";
import { diffSequences } from "./objects/sequence/sequence.diff.ts";
import { diffSubscriptions } from "./objects/subscription/subscription.diff.ts";
import { diffTables } from "./objects/table/table.diff.ts";
import { diffTriggers } from "./objects/trigger/trigger.diff.ts";
import { diffCompositeTypes } from "./objects/type/composite-type/composite-type.diff.ts";
import { diffEnums } from "./objects/type/enum/enum.diff.ts";
import { diffRanges } from "./objects/type/range/range.diff.ts";
import { stringifyWithBigInt } from "./objects/utils.ts";
import { diffViews } from "./objects/view/view.diff.ts";

export function diffCatalogs(main: Catalog, branch: Catalog) {
  const changes: Change[] = [];

  // Step 1: Diff roles first to get default privilege changes
  const roleChanges = diffRoles(
    { version: main.version },
    main.roles,
    branch.roles,
  );
  changes.push(...roleChanges);

  // Step 2: Compute default privileges state from role changes
  // This represents what defaults will be in effect after all ALTER DEFAULT PRIVILEGES
  // Since ALTER DEFAULT PRIVILEGES runs before CREATE (via constraint spec),
  // all created objects will use these final defaults.
  const defaultPrivilegeState = new DefaultPrivilegeState(main.roles);
  for (const change of roleChanges) {
    if (change instanceof GrantRoleDefaultPrivileges) {
      defaultPrivilegeState.applyGrant(
        change.role.name,
        change.objtype,
        change.inSchema,
        change.grantee,
        change.privileges,
      );
    } else if (change instanceof RevokeRoleDefaultPrivileges) {
      defaultPrivilegeState.applyRevoke(
        change.role.name,
        change.objtype,
        change.inSchema,
        change.grantee,
        change.privileges,
      );
    }
  }

  // Step 3: Create context with default privileges state for object diffing
  const diffContext = {
    version: main.version,
    currentUser: main.currentUser,
    defaultPrivilegeState,
    mainRoles: main.roles,
  };

  // Step 4: Diff all other objects with default privileges context
  changes.push(
    ...diffAggregates(diffContext, main.aggregates, branch.aggregates),
  );
  changes.push(
    ...diffCollations(
      { currentUser: main.currentUser },
      main.collations,
      branch.collations,
    ),
  );
  changes.push(
    ...diffCompositeTypes(
      diffContext,
      main.compositeTypes,
      branch.compositeTypes,
    ),
  );
  changes.push(...diffDomains(diffContext, main.domains, branch.domains));
  changes.push(...diffEnums(diffContext, main.enums, branch.enums));
  changes.push(...diffExtensions(main.extensions, branch.extensions));
  changes.push(
    ...diffIndexes(main.indexes, branch.indexes, branch.indexableObjects),
  );
  changes.push(
    ...diffMaterializedViews(
      diffContext,
      main.materializedViews,
      branch.materializedViews,
    ),
  );
  changes.push(
    ...diffSubscriptions(
      { currentUser: main.currentUser },
      main.subscriptions,
      branch.subscriptions,
    ),
  );
  changes.push(
    ...diffPublications(
      { currentUser: main.currentUser },
      main.publications,
      branch.publications,
    ),
  );
  changes.push(
    ...diffProcedures(diffContext, main.procedures, branch.procedures),
  );
  changes.push(...diffRlsPolicies(main.rlsPolicies, branch.rlsPolicies));
  changes.push(...diffSchemas(diffContext, main.schemas, branch.schemas));
  changes.push(
    ...diffSequences(
      diffContext,
      main.sequences,
      branch.sequences,
      branch.tables,
    ),
  );
  changes.push(...diffTables(diffContext, main.tables, branch.tables));
  changes.push(
    ...diffTriggers(main.triggers, branch.triggers, branch.indexableObjects),
  );
  changes.push(
    ...diffEventTriggers(
      { currentUser: main.currentUser },
      main.eventTriggers,
      branch.eventTriggers,
    ),
  );
  changes.push(...diffRules(main.rules, branch.rules));
  changes.push(...diffRanges(diffContext, main.ranges, branch.ranges));
  changes.push(...diffViews(diffContext, main.views, branch.views));
  // Foreign Data Wrapper objects (in dependency order)
  changes.push(
    ...diffForeignDataWrappers(
      diffContext,
      main.foreignDataWrappers,
      branch.foreignDataWrappers,
    ),
  );
  changes.push(...diffServers(diffContext, main.servers, branch.servers));
  changes.push(...diffUserMappings(main.userMappings, branch.userMappings));
  changes.push(
    ...diffForeignTables(diffContext, main.foreignTables, branch.foreignTables),
  );

  // Filter privilege REVOKEs for objects that are being dropped
  // Avoid emitting redundant REVOKE statements for targets that will no longer exist.
  const droppedObjectStableIds = new Set<string>();
  for (const change of changes) {
    if (change.operation === "drop" && change.scope === "object") {
      for (const dep of change.requires) {
        droppedObjectStableIds.add(dep);
      }
    }
  }
  const filteredChanges = changes.filter((change) => {
    if (change.operation === "alter" && change.scope === "privilege") {
      switch (change.objectType) {
        case "composite_type":
          return !droppedObjectStableIds.has(change.compositeType.stableId);
        case "domain":
          return !droppedObjectStableIds.has(change.domain.stableId);
        case "enum":
          return !droppedObjectStableIds.has(change.enum.stableId);
        case "language":
          return !droppedObjectStableIds.has(change.language.stableId);
        case "materialized_view":
          return !droppedObjectStableIds.has(change.materializedView.stableId);
        case "aggregate":
          return !droppedObjectStableIds.has(change.aggregate.stableId);
        case "procedure":
          return !droppedObjectStableIds.has(change.procedure.stableId);
        case "range":
          return !droppedObjectStableIds.has(change.range.stableId);
        case "schema":
          return !droppedObjectStableIds.has(change.schema.stableId);
        case "sequence":
          return !droppedObjectStableIds.has(change.sequence.stableId);
        case "table":
          return !droppedObjectStableIds.has(change.table.stableId);
        case "view":
          return !droppedObjectStableIds.has(change.view.stableId);
        case "foreign_data_wrapper":
          return !droppedObjectStableIds.has(
            change.foreignDataWrapper.stableId,
          );
        case "server":
          return !droppedObjectStableIds.has(change.server.stableId);
        case "foreign_table":
          return !droppedObjectStableIds.has(change.foreignTable.stableId);
        default: {
          // exhaustiveness check
          const _exhaustive: never = change;
          return _exhaustive;
        }
      }
    }
    return true;
  });

  if (DEBUG) {
    console.log(
      "changes catalog diff: ",
      stringifyWithBigInt(filteredChanges, 2),
    );
  }

  return filteredChanges;
}
