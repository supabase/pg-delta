import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  groupPrivilegesByColumns,
} from "../base.privilege-diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterMaterializedViewChangeOwner,
  AlterMaterializedViewSetStorageParams,
} from "./changes/materialized-view.alter.ts";
import {
  CreateCommentOnMaterializedView,
  CreateCommentOnMaterializedViewColumn,
  DropCommentOnMaterializedView,
  DropCommentOnMaterializedViewColumn,
} from "./changes/materialized-view.comment.ts";
import { CreateMaterializedView } from "./changes/materialized-view.create.ts";
import { DropMaterializedView } from "./changes/materialized-view.drop.ts";
import {
  GrantMaterializedViewPrivileges,
  RevokeGrantOptionMaterializedViewPrivileges,
  RevokeMaterializedViewPrivileges,
} from "./changes/materialized-view.privilege.ts";
import type { MaterializedViewChange } from "./changes/materialized-view.types.ts";
import type { MaterializedView } from "./materialized-view.model.ts";

/**
 * Diff two sets of materialized views from main and branch catalogs.
 *
 * @param ctx - Context containing version information.
 * @param main - The materialized views in the main catalog.
 * @param branch - The materialized views in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffMaterializedViews(
  ctx: {
    version: number;
    currentUser?: string;
    defaultPrivilegeState?: unknown;
  },
  main: Record<string, MaterializedView>,
  branch: Record<string, MaterializedView>,
): MaterializedViewChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: MaterializedViewChange[] = [];

  for (const materializedViewId of created) {
    changes.push(
      new CreateMaterializedView({
        materializedView: branch[materializedViewId],
      }),
    );
    // Materialized view comment on creation
    if (branch[materializedViewId].comment !== null) {
      changes.push(
        new CreateCommentOnMaterializedView({
          materializedView: branch[materializedViewId],
        }),
      );
    }
    // Column comments on creation
    for (const col of branch[materializedViewId].columns) {
      if (col.comment !== null) {
        changes.push(
          new CreateCommentOnMaterializedViewColumn({
            materializedView: branch[materializedViewId],
            column: col,
          }),
        );
      }
    }
  }

  for (const materializedViewId of dropped) {
    changes.push(
      new DropMaterializedView({ materializedView: main[materializedViewId] }),
    );
  }

  for (const materializedViewId of altered) {
    const mainMaterializedView = main[materializedViewId];
    const branchMaterializedView = branch[materializedViewId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the materialized view
    const NON_ALTERABLE_FIELDS: Array<keyof MaterializedView> = [
      "definition",
      "row_security",
      "force_row_security",
      "has_indexes",
      "has_rules",
      "has_triggers",
      "has_subclasses",
      "is_populated",
      "replica_identity",
      "is_partition",
      "partition_bound",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainMaterializedView,
      branchMaterializedView,
      NON_ALTERABLE_FIELDS,
      { options: deepEqual },
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire materialized view (drop + create)
      changes.push(
        new DropMaterializedView({ materializedView: mainMaterializedView }),
        new CreateMaterializedView({
          materializedView: branchMaterializedView,
        }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainMaterializedView.owner !== branchMaterializedView.owner) {
        changes.push(
          new AlterMaterializedViewChangeOwner({
            materializedView: mainMaterializedView,
            owner: branchMaterializedView.owner,
          }),
        );
      }

      // STORAGE PARAMETERS (reloptions)
      // Emit a combined SET/RESET change similar to indexes
      if (
        !deepEqual(mainMaterializedView.options, branchMaterializedView.options)
      ) {
        const parseOptions = (options: string[] | null | undefined) => {
          const map = new Map<string, string>();
          if (!options) return map;
          for (const opt of options) {
            const eqIndex = opt.indexOf("=");
            const key = opt.slice(0, eqIndex).trim();
            const value = opt.slice(eqIndex + 1).trim();
            map.set(key, value);
          }
          return map;
        };
        const mainMap = parseOptions(mainMaterializedView.options);
        const branchMap = parseOptions(branchMaterializedView.options);
        const keysToReset: string[] = [];
        for (const key of mainMap.keys()) {
          if (!branchMap.has(key)) keysToReset.push(key);
        }
        const paramsToSet: string[] = [];
        for (const [key, newValue] of branchMap.entries()) {
          const oldValue = mainMap.get(key);
          const changed = oldValue !== newValue;
          if (changed) {
            paramsToSet.push(
              newValue === undefined ? key : `${key}=${newValue}`,
            );
          }
        }
        changes.push(
          new AlterMaterializedViewSetStorageParams({
            materializedView: mainMaterializedView,
            paramsToSet,
            keysToReset,
          }),
        );
      }

      // Note: Materialized view renaming would also use ALTER MATERIALIZED VIEW ... RENAME TO ...
      // But since our MaterializedView model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
      // MATERIALIZED VIEW COMMENT (create/drop when comment changes)
      if (mainMaterializedView.comment !== branchMaterializedView.comment) {
        if (branchMaterializedView.comment === null) {
          changes.push(
            new DropCommentOnMaterializedView({
              materializedView: mainMaterializedView,
            }),
          );
        } else {
          changes.push(
            new CreateCommentOnMaterializedView({
              materializedView: branchMaterializedView,
            }),
          );
        }
      }
      // COMMENT changes on columns
      const mainCols = new Map(
        mainMaterializedView.columns.map((c) => [c.name, c]),
      );
      const branchCols = new Map(
        branchMaterializedView.columns.map((c) => [c.name, c]),
      );
      for (const [name, branchCol] of branchCols) {
        const mainCol = mainCols.get(name);
        if (!mainCol) continue;
        if (mainCol.comment !== branchCol.comment) {
          if (branchCol.comment === null) {
            changes.push(
              new DropCommentOnMaterializedViewColumn({
                materializedView: mainMaterializedView,
                column: mainCol,
              }),
            );
          } else {
            changes.push(
              new CreateCommentOnMaterializedViewColumn({
                materializedView: branchMaterializedView,
                column: branchCol,
              }),
            );
          }
        }
      }

      // PRIVILEGES (unified object and column privileges)
      const privilegeResults = diffPrivileges(
        mainMaterializedView.privileges,
        branchMaterializedView.privileges,
      );

      for (const [grantee, result] of privilegeResults) {
        // Generate grant changes
        if (result.grants.length > 0) {
          const grantGroups = groupPrivilegesByColumns(result.grants);
          for (const [, group] of grantGroups) {
            for (const [grantable, privSet] of group.byGrant) {
              const privileges = Array.from(privSet).map((priv) => ({
                privilege: priv,
                grantable,
              }));
              changes.push(
                new GrantMaterializedViewPrivileges({
                  materializedView: branchMaterializedView,
                  grantee,
                  privileges,
                  columns: group.columns,
                  version: ctx.version,
                }),
              );
            }
          }
        }

        // Generate revoke changes
        if (result.revokes.length > 0) {
          const revokeGroups = groupPrivilegesByColumns(result.revokes);
          for (const [, group] of revokeGroups) {
            // Collapse all grantable groups into a single revoke (grantable: false)
            const allPrivileges = new Set<string>();
            for (const [, privSet] of group.byGrant) {
              for (const priv of privSet) {
                allPrivileges.add(priv);
              }
            }
            const privileges = Array.from(allPrivileges).map((priv) => ({
              privilege: priv,
              grantable: false,
            }));
            changes.push(
              new RevokeMaterializedViewPrivileges({
                materializedView: mainMaterializedView,
                grantee,
                privileges,
                columns: group.columns,
                version: ctx.version,
              }),
            );
          }
        }

        // Generate revoke grant option changes
        if (result.revokeGrantOption.length > 0) {
          const revokeGrantGroups = new Map<
            string,
            { columns?: string[]; privileges: Set<string> }
          >();
          for (const r of result.revokeGrantOption) {
            // For revoke grant option, we need to find the columns from the original privilege
            const originalPriv = mainMaterializedView.privileges.find(
              (p) => p.grantee === grantee && p.privilege === r,
            );
            const key = originalPriv?.columns
              ? originalPriv.columns.sort().join(",")
              : "";
            if (!revokeGrantGroups.has(key)) {
              revokeGrantGroups.set(key, {
                columns: originalPriv?.columns
                  ? [...originalPriv.columns]
                  : undefined,
                privileges: new Set(),
              });
            }
            const group = revokeGrantGroups.get(key);
            if (!group) continue;
            group.privileges.add(r);
          }
          for (const [, group] of revokeGrantGroups) {
            const privilegeNames = Array.from(group.privileges);
            changes.push(
              new RevokeGrantOptionMaterializedViewPrivileges({
                materializedView: mainMaterializedView,
                grantee,
                privilegeNames,
                columns: group.columns,
                version: ctx.version,
              }),
            );
          }
        }
      }
    }
  }

  return changes;
}
