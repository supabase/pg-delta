import type { DefaultPrivilegeState } from "../base.default-privileges.ts";
import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  groupPrivilegesByGrantable,
} from "../base.privilege-diff.ts";
import type { Role } from "../role/role.model.ts";
import { AlterSchemaChangeOwner } from "./changes/schema.alter.ts";
import {
  CreateCommentOnSchema,
  DropCommentOnSchema,
} from "./changes/schema.comment.ts";
import { CreateSchema } from "./changes/schema.create.ts";
import { DropSchema } from "./changes/schema.drop.ts";
import {
  GrantSchemaPrivileges,
  RevokeGrantOptionSchemaPrivileges,
  RevokeSchemaPrivileges,
} from "./changes/schema.privilege.ts";
import type { SchemaChange } from "./changes/schema.types.ts";
import type { Schema } from "./schema.model.ts";

/**
 * Diff two sets of schemas from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The schemas in the main catalog.
 * @param branch - The schemas in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffSchemas(
  ctx: {
    version: number;
    currentUser: string;
    defaultPrivilegeState: DefaultPrivilegeState;
    mainRoles: Record<string, Role>;
  },
  main: Record<string, Schema>,
  branch: Record<string, Schema>,
): SchemaChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: SchemaChange[] = [];

  for (const schemaId of created) {
    const sc = branch[schemaId];
    changes.push(new CreateSchema({ schema: sc }));
    if (sc.comment !== null) {
      changes.push(new CreateCommentOnSchema({ schema: sc }));
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    // Note: Schemas don't have a schema property, so we pass empty string
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "schema",
      "",
    );
    const desiredPrivileges = sc.privileges;
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use the schema owner as the reference.
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
      sc.owner,
      ctx.mainRoles,
    );

    // Generate grant changes
    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantSchemaPrivileges({
              schema: sc,
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
            new RevokeSchemaPrivileges({
              schema: sc,
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
          new RevokeGrantOptionSchemaPrivileges({
            schema: sc,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }
  }

  for (const schemaId of dropped) {
    changes.push(new DropSchema({ schema: main[schemaId] }));
  }

  for (const schemaId of altered) {
    const mainSchema = main[schemaId];
    const branchSchema = branch[schemaId];

    // OWNER
    if (mainSchema.owner !== branchSchema.owner) {
      changes.push(
        new AlterSchemaChangeOwner({
          schema: mainSchema,
          owner: branchSchema.owner,
        }),
      );
    }

    // COMMENT
    if (mainSchema.comment !== branchSchema.comment) {
      if (branchSchema.comment === null) {
        changes.push(new DropCommentOnSchema({ schema: mainSchema }));
      } else {
        changes.push(new CreateCommentOnSchema({ schema: branchSchema }));
      }
    }

    // PRIVILEGES
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use branch owner as the reference.
    const privilegeResults = diffPrivileges(
      mainSchema.privileges,
      branchSchema.privileges,
      branchSchema.owner,
      ctx.mainRoles,
    );

    for (const [grantee, result] of privilegeResults) {
      // Generate grant changes
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantSchemaPrivileges({
              schema: branchSchema,
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
            new RevokeSchemaPrivileges({
              schema: mainSchema,
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
          new RevokeGrantOptionSchemaPrivileges({
            schema: mainSchema,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }

    // Note: Schema renaming would also use ALTER SCHEMA ... RENAME TO ...
    // But since our Schema model uses 'schema' as the identity field,
    // a name change would be handled as drop + create by diffObjects()
  }

  return changes;
}
