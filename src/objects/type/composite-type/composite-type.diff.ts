import type { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import { diffObjects } from "../../base.diff.ts";
import {
  diffPrivileges,
  filterPublicBuiltInDefaults,
  groupPrivilegesByGrantable,
} from "../../base.privilege-diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../../utils.ts";
import {
  AlterCompositeTypeAddAttribute,
  AlterCompositeTypeAlterAttributeType,
  AlterCompositeTypeChangeOwner,
  AlterCompositeTypeDropAttribute,
} from "./changes/composite-type.alter.ts";
import {
  CreateCommentOnCompositeType,
  CreateCommentOnCompositeTypeAttribute,
  DropCommentOnCompositeType,
  DropCommentOnCompositeTypeAttribute,
} from "./changes/composite-type.comment.ts";
import { CreateCompositeType } from "./changes/composite-type.create.ts";
import { DropCompositeType } from "./changes/composite-type.drop.ts";
import {
  GrantCompositeTypePrivileges,
  RevokeCompositeTypePrivileges,
  RevokeGrantOptionCompositeTypePrivileges,
} from "./changes/composite-type.privilege.ts";
import type { CompositeTypeChange } from "./changes/composite-type.types.ts";
import type { CompositeType } from "./composite-type.model.ts";

/**
 * Diff two sets of composite types from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The composite types in the main catalog.
 * @param branch - The composite types in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffCompositeTypes(
  ctx: {
    version: number;
    currentUser: string;
    defaultPrivilegeState: DefaultPrivilegeState;
  },
  main: Record<string, CompositeType>,
  branch: Record<string, CompositeType>,
): CompositeTypeChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: CompositeTypeChange[] = [];

  for (const compositeTypeId of created) {
    const ct = branch[compositeTypeId];
    changes.push(new CreateCompositeType({ compositeType: ct }));

    // OWNER: If the composite type should be owned by someone other than the current user,
    // emit ALTER TYPE ... OWNER TO after creation
    if (ct.owner !== ctx.currentUser) {
      changes.push(
        new AlterCompositeTypeChangeOwner({
          compositeType: ct,
          owner: ct.owner,
        }),
      );
    }

    // Type comment on creation
    if (ct.comment !== null) {
      changes.push(new CreateCommentOnCompositeType({ compositeType: ct }));
    }
    // Attribute comments on creation
    for (const attr of ct.columns) {
      if (attr.comment !== null) {
        changes.push(
          new CreateCommentOnCompositeTypeAttribute({
            compositeType: ct,
            attribute: attr,
          }),
        );
      }
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "composite_type",
      ct.schema ?? "",
    );
    // Filter out PUBLIC's built-in default USAGE privilege (PostgreSQL grants it automatically)
    // Reference: https://www.postgresql.org/docs/17/ddl-priv.html Table 5.2
    // This prevents generating unnecessary "GRANT USAGE TO PUBLIC" statements
    const desiredPrivileges = filterPublicBuiltInDefaults(
      "composite_type",
      ct.privileges,
    );
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
    );

    // Generate grant changes
    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantCompositeTypePrivileges({
              compositeType: ct,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke changes
      if (result.revokes.length > 0) {
        const revokeGroups = groupPrivilegesByGrantable(result.revokes);
        for (const [grantable, list] of revokeGroups) {
          void grantable;
          changes.push(
            new RevokeCompositeTypePrivileges({
              compositeType: ct,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke grant option changes
      if (result.revokeGrantOption.length > 0) {
        changes.push(
          new RevokeGrantOptionCompositeTypePrivileges({
            compositeType: ct,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }
  }

  for (const compositeTypeId of dropped) {
    changes.push(
      new DropCompositeType({ compositeType: main[compositeTypeId] }),
    );
  }

  for (const compositeTypeId of altered) {
    const mainCompositeType = main[compositeTypeId];
    const branchCompositeType = branch[compositeTypeId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the composite type
    const NON_ALTERABLE_FIELDS: Array<keyof CompositeType> = [
      "row_security",
      "force_row_security",
      "has_indexes",
      "has_rules",
      "has_triggers",
      "has_subclasses",
      "is_populated",
      "replica_identity",
      "is_partition",
      "options",
      "partition_bound",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainCompositeType,
      branchCompositeType,
      NON_ALTERABLE_FIELDS,
      { options: deepEqual },
    );

    if (nonAlterablePropsChanged) {
      // Replacement is not performed automatically for composite types
      // to avoid destructive operations; keep changes minimal.
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainCompositeType.owner !== branchCompositeType.owner) {
        changes.push(
          new AlterCompositeTypeChangeOwner({
            compositeType: mainCompositeType,
            owner: branchCompositeType.owner,
          }),
        );
      }

      // TYPE COMMENT (create/drop when comment changes)
      if (mainCompositeType.comment !== branchCompositeType.comment) {
        if (branchCompositeType.comment === null) {
          changes.push(
            new DropCommentOnCompositeType({
              compositeType: mainCompositeType,
            }),
          );
        } else {
          changes.push(
            new CreateCommentOnCompositeType({
              compositeType: branchCompositeType,
            }),
          );
        }
      }

      // ATTRIBUTE diffs
      const mainAttrs = new Map(
        mainCompositeType.columns.map((c) => [c.name, c]),
      );
      const branchAttrs = new Map(
        branchCompositeType.columns.map((c) => [c.name, c]),
      );

      // Added attributes
      for (const [name, attr] of branchAttrs) {
        if (!mainAttrs.has(name)) {
          changes.push(
            new AlterCompositeTypeAddAttribute({
              compositeType: branchCompositeType,
              attribute: attr,
            }),
          );
          if (attr.comment !== null) {
            changes.push(
              new CreateCommentOnCompositeTypeAttribute({
                compositeType: branchCompositeType,
                attribute: attr,
              }),
            );
          }
        }
      }

      // Dropped attributes
      for (const [name, attr] of mainAttrs) {
        if (!branchAttrs.has(name)) {
          changes.push(
            new AlterCompositeTypeDropAttribute({
              compositeType: mainCompositeType,
              attribute: attr,
            }),
          );
        }
      }

      // Altered attribute type/collation
      for (const [name, mainAttr] of mainAttrs) {
        const branchAttr = branchAttrs.get(name);
        if (!branchAttr) continue;
        if (
          mainAttr.data_type_str !== branchAttr.data_type_str ||
          mainAttr.collation !== branchAttr.collation
        ) {
          changes.push(
            new AlterCompositeTypeAlterAttributeType({
              compositeType: branchCompositeType,
              attribute: branchAttr,
            }),
          );
        }

        // COMMENT change on attribute
        if (mainAttr.comment !== branchAttr.comment) {
          if (branchAttr.comment === null) {
            changes.push(
              new DropCommentOnCompositeTypeAttribute({
                compositeType: mainCompositeType,
                attribute: mainAttr,
              }),
            );
          } else {
            changes.push(
              new CreateCommentOnCompositeTypeAttribute({
                compositeType: branchCompositeType,
                attribute: branchAttr,
              }),
            );
          }
        }
      }

      // PRIVILEGES
      const privilegeResults = diffPrivileges(
        mainCompositeType.privileges,
        branchCompositeType.privileges,
      );

      for (const [grantee, result] of privilegeResults) {
        // Generate grant changes
        if (result.grants.length > 0) {
          const grantGroups = groupPrivilegesByGrantable(result.grants);
          for (const [grantable, list] of grantGroups) {
            void grantable;
            changes.push(
              new GrantCompositeTypePrivileges({
                compositeType: branchCompositeType,
                grantee,
                privileges: list,
                version: ctx.version,
              }),
            );
          }
        }

        // Generate revoke changes
        if (result.revokes.length > 0) {
          const revokeGroups = groupPrivilegesByGrantable(result.revokes);
          for (const [grantable, list] of revokeGroups) {
            void grantable;
            changes.push(
              new RevokeCompositeTypePrivileges({
                compositeType: mainCompositeType,
                grantee,
                privileges: list,
                version: ctx.version,
              }),
            );
          }
        }

        // Generate revoke grant option changes
        if (result.revokeGrantOption.length > 0) {
          changes.push(
            new RevokeGrantOptionCompositeTypePrivileges({
              compositeType: mainCompositeType,
              grantee,
              privilegeNames: result.revokeGrantOption,
              version: ctx.version,
            }),
          );
        }
      }

      // Note: Composite type renaming would also use ALTER TYPE ... RENAME TO ...
      // But since our CompositeType model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
