import { DEBUG } from "../tests/constants.ts";
import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./objects/base.change.ts";
import { diffCollations } from "./objects/collation/collation.diff.ts";
import { diffDomains } from "./objects/domain/domain.diff.ts";
import { diffExtensions } from "./objects/extension/extension.diff.ts";
import { diffIndexes } from "./objects/index/index.diff.ts";
import { diffMaterializedViews } from "./objects/materialized-view/materialized-view.diff.ts";
import { RevokeColumnPrivileges } from "./objects/privilege/column-privilege/changes/column-privilege.alter.ts";
import { diffColumnPrivileges } from "./objects/privilege/column-privilege/column-privilege.diff.ts";
import { diffDefaultPrivileges } from "./objects/privilege/default-privilege/default-privilege.diff.ts";
import { diffRoleMemberships } from "./objects/privilege/membership/membership.diff.ts";
import {
  RevokeGrantOptionObjectPrivileges,
  RevokeObjectPrivileges,
} from "./objects/privilege/object-privilege/changes/object-privilege.alter.ts";
import { diffObjectPrivileges } from "./objects/privilege/object-privilege/object-privilege.diff.ts";
import { diffProcedures } from "./objects/procedure/procedure.diff.ts";
import { diffRlsPolicies } from "./objects/rls-policy/rls-policy.diff.ts";
import { diffRoles } from "./objects/role/role.diff.ts";
import { diffSchemas } from "./objects/schema/schema.diff.ts";
import { diffSequences } from "./objects/sequence/sequence.diff.ts";
import { diffTables } from "./objects/table/table.diff.ts";
import { diffTriggers } from "./objects/trigger/trigger.diff.ts";
import { diffCompositeTypes } from "./objects/type/composite-type/composite-type.diff.ts";
import { diffEnums } from "./objects/type/enum/enum.diff.ts";
import { diffRanges } from "./objects/type/range/range.diff.ts";
import { stringifyWithBigInt } from "./objects/utils.ts";
import { diffViews } from "./objects/view/view.diff.ts";

export function diffCatalogs(main: Catalog, branch: Catalog) {
  const changes: Change[] = [];
  changes.push(...diffCollations(main.collations, branch.collations));
  changes.push(
    ...diffCompositeTypes(main.compositeTypes, branch.compositeTypes),
  );
  changes.push(...diffDomains(main.domains, branch.domains));
  changes.push(...diffEnums(main.enums, branch.enums));
  changes.push(...diffExtensions(main.extensions, branch.extensions));
  changes.push(
    ...diffIndexes(main.indexes, branch.indexes, branch.indexableObjects),
  );
  changes.push(
    ...diffMaterializedViews(main.materializedViews, branch.materializedViews),
  );
  changes.push(...diffProcedures(main.procedures, branch.procedures));
  changes.push(...diffRlsPolicies(main.rlsPolicies, branch.rlsPolicies));
  changes.push(...diffRoles(main.roles, branch.roles));
  changes.push(...diffSchemas(main.schemas, branch.schemas));
  changes.push(...diffSequences(main.sequences, branch.sequences));
  changes.push(
    ...diffTables({ version: branch.version }, main.tables, branch.tables),
  );
  changes.push(
    ...diffTriggers(main.triggers, branch.triggers, branch.indexableObjects),
  );
  changes.push(...diffRanges(main.ranges, branch.ranges));
  changes.push(...diffViews(main.views, branch.views));

  // Privileges depend on objects and roles
  changes.push(
    ...diffRoleMemberships(main.roleMemberships, branch.roleMemberships),
  );
  changes.push(
    ...diffObjectPrivileges(
      { version: branch.version },
      main.objectPrivileges,
      branch.objectPrivileges,
    ),
  );
  changes.push(
    ...diffColumnPrivileges(main.columnPrivileges, branch.columnPrivileges),
  );
  changes.push(
    ...diffDefaultPrivileges(
      { version: branch.version },
      main.defaultPrivileges,
      branch.defaultPrivileges,
    ),
  );

  // Filter privilege REVOKEs for objects that are being dropped
  // Avoid emitting redundant REVOKE statements for targets that will no longer exist.
  const droppedObjectStableIds = new Set<string>();
  for (const ch of changes) {
    if (ch.operation === "drop" && ch.scope === "object") {
      for (const dep of ch.dependencies) droppedObjectStableIds.add(dep);
    }
  }
  const filtered = changes.filter((ch) => {
    if (
      ch instanceof RevokeObjectPrivileges ||
      ch instanceof RevokeGrantOptionObjectPrivileges
    )
      return !droppedObjectStableIds.has(ch.objectId);
    if (ch instanceof RevokeColumnPrivileges)
      return !droppedObjectStableIds.has(ch.tableId);
    return true;
  });

  if (DEBUG) {
    console.log("changes catalog diff: ", stringifyWithBigInt(filtered, 2));
  }

  return filtered;
}
