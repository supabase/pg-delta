import { DEBUG } from "../tests/constants.ts";
import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { diffCollations } from "./objects/collation/collation.diff.ts";
import { diffDomains } from "./objects/domain/domain.diff.ts";
import { diffExtensions } from "./objects/extension/extension.diff.ts";
import { diffIndexes } from "./objects/index/index.diff.ts";
import { diffMaterializedViews } from "./objects/materialized-view/materialized-view.diff.ts";
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
    ...diffCompositeTypes(
      { version: main.version },
      main.compositeTypes,
      branch.compositeTypes,
    ),
  );
  changes.push(
    ...diffDomains({ version: main.version }, main.domains, branch.domains),
  );
  changes.push(
    ...diffEnums({ version: main.version }, main.enums, branch.enums),
  );
  changes.push(...diffExtensions(main.extensions, branch.extensions));
  changes.push(
    ...diffIndexes(main.indexes, branch.indexes, branch.indexableObjects),
  );
  changes.push(
    ...diffMaterializedViews(
      { version: main.version },
      main.materializedViews,
      branch.materializedViews,
    ),
  );
  changes.push(
    ...diffProcedures(
      { version: main.version },
      main.procedures,
      branch.procedures,
    ),
  );
  changes.push(...diffRlsPolicies(main.rlsPolicies, branch.rlsPolicies));
  changes.push(
    ...diffRoles({ version: main.version }, main.roles, branch.roles),
  );
  changes.push(
    ...diffSchemas({ version: main.version }, main.schemas, branch.schemas),
  );
  changes.push(
    ...diffSequences(
      { version: main.version },
      main.sequences,
      branch.sequences,
    ),
  );
  changes.push(
    ...diffTables({ version: main.version }, main.tables, branch.tables),
  );
  changes.push(
    ...diffTriggers(main.triggers, branch.triggers, branch.indexableObjects),
  );
  changes.push(
    ...diffRanges({ version: main.version }, main.ranges, branch.ranges),
  );
  changes.push(
    ...diffViews({ version: main.version }, main.views, branch.views),
  );

  // Filter privilege REVOKEs for objects that are being dropped
  // Avoid emitting redundant REVOKE statements for targets that will no longer exist.
  // TODO: Refactor using the new privileges within objects approach
  // const droppedObjectStableIds = new Set<string>();
  // for (const ch of changes) {
  //   if (ch.operation === "drop" && ch.scope === "object") {
  //     for (const dep of ch.dependencies) droppedObjectStableIds.add(dep);
  //   }
  // }
  // const filtered = changes.filter((ch) => {
  //   if (
  //     ch instanceof RevokeObjectPrivileges ||
  //     ch instanceof RevokeGrantOptionObjectPrivileges
  //   )
  //     return !droppedObjectStableIds.has(ch.objectId);
  //   if (ch instanceof RevokeColumnPrivileges)
  //     return !droppedObjectStableIds.has(ch.tableId);
  //   return true;
  // });

  if (DEBUG) {
    console.log("changes catalog diff: ", stringifyWithBigInt(changes, 2));
  }

  return changes;
}
