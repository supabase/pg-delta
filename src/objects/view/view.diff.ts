import type { DefaultPrivilegeState } from "../base.default-privileges.ts";
import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  groupPrivilegesByColumns,
} from "../base.privilege-diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterViewChangeOwner,
  AlterViewResetOptions,
  AlterViewSetOptions,
} from "./changes/view.alter.ts";
import {
  CreateCommentOnView,
  DropCommentOnView,
} from "./changes/view.comment.ts";
import { CreateView } from "./changes/view.create.ts";
import { DropView } from "./changes/view.drop.ts";
import {
  GrantViewPrivileges,
  RevokeGrantOptionViewPrivileges,
  RevokeViewPrivileges,
} from "./changes/view.privilege.ts";
import type { ViewChange } from "./changes/view.types.ts";
import type { View } from "./view.model.ts";

/**
 * Diff two sets of views from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The views in the main catalog.
 * @param branch - The views in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffViews(
  ctx: {
    version: number;
    currentUser: string;
    defaultPrivilegeState: DefaultPrivilegeState;
  },
  main: Record<string, View>,
  branch: Record<string, View>,
): ViewChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: ViewChange[] = [];

  for (const viewId of created) {
    const v = branch[viewId];
    changes.push(new CreateView({ view: v }));

    // OWNER: If the view should be owned by someone other than the current user,
    // emit ALTER VIEW ... OWNER TO after creation
    if (v.owner !== ctx.currentUser) {
      changes.push(new AlterViewChangeOwner({ view: v, owner: v.owner }));
    }

    if (v.comment !== null) {
      changes.push(new CreateCommentOnView({ view: v }));
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "view",
      v.schema ?? "",
    );
    const desiredPrivileges = v.privileges;
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
    );

    // Generate grant changes
    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByColumns(result.grants);
        for (const [, group] of grantGroups) {
          for (const [grantable, privSet] of group.byGrant) {
            const privileges = Array.from(privSet).map((priv) => ({
              privilege: priv,
              grantable,
            }));
            changes.push(
              new GrantViewPrivileges({
                view: v,
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
            new RevokeViewPrivileges({
              view: v,
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
          // For revoke grant option, we need to find the columns from the effective defaults
          const originalPriv = effectiveDefaults.find(
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
            new RevokeGrantOptionViewPrivileges({
              view: v,
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

  for (const viewId of dropped) {
    changes.push(new DropView({ view: main[viewId] }));
  }

  for (const viewId of altered) {
    const mainView = main[viewId];
    const branchView = branch[viewId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the view
    const NON_ALTERABLE_FIELDS: Array<keyof View> = [
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
      mainView,
      branchView,
      NON_ALTERABLE_FIELDS,
      { options: deepEqual },
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire view using CREATE OR REPLACE to avoid drop when possible
      changes.push(new CreateView({ view: branchView, orReplace: true }));
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainView.owner !== branchView.owner) {
        changes.push(
          new AlterViewChangeOwner({ view: mainView, owner: branchView.owner }),
        );
      }

      // VIEW OPTIONS (WITH (...))
      if (!deepEqual(mainView.options, branchView.options)) {
        const mainOpts = mainView.options ?? [];
        const branchOpts = branchView.options ?? [];

        // Always set branch options when provided
        if (branchOpts.length > 0) {
          changes.push(
            new AlterViewSetOptions({ view: mainView, options: branchOpts }),
          );
        }

        // Reset any params that are present in main but absent in branch
        if (mainOpts.length > 0) {
          const mainNames = new Set(mainOpts.map((opt) => opt.split("=")[0]));
          const branchNames = new Set(
            branchOpts.map((opt) => opt.split("=")[0]),
          );
          const removed: string[] = [];
          for (const name of mainNames) {
            if (!branchNames.has(name)) removed.push(name);
          }
          if (removed.length > 0) {
            changes.push(
              new AlterViewResetOptions({ view: mainView, params: removed }),
            );
          }
        }
      }

      // COMMENT
      if (mainView.comment !== branchView.comment) {
        if (branchView.comment === null) {
          changes.push(new DropCommentOnView({ view: mainView }));
        } else {
          changes.push(new CreateCommentOnView({ view: branchView }));
        }
      }

      // Note: View renaming would also use ALTER VIEW ... RENAME TO ...
      // But since our View model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()

      // PRIVILEGES (unified object and column privileges)
      const privilegeResults = diffPrivileges(
        mainView.privileges,
        branchView.privileges,
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
                new GrantViewPrivileges({
                  view: branchView,
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
              new RevokeViewPrivileges({
                view: mainView,
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
            const originalPriv = mainView.privileges.find(
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
              new RevokeGrantOptionViewPrivileges({
                view: mainView,
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
