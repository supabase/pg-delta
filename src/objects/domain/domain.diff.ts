import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  groupPrivilegesByGrantable,
} from "../base.privilege-diff.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainChangeOwner,
  AlterDomainDropConstraint,
  AlterDomainDropDefault,
  AlterDomainDropNotNull,
  AlterDomainSetDefault,
  AlterDomainSetNotNull,
  AlterDomainValidateConstraint,
} from "./changes/domain.alter.ts";
import {
  CreateCommentOnDomain,
  DropCommentOnDomain,
} from "./changes/domain.comment.ts";
import { CreateDomain } from "./changes/domain.create.ts";
import { DropDomain } from "./changes/domain.drop.ts";
import {
  GrantDomainPrivileges,
  RevokeDomainPrivileges,
  RevokeGrantOptionDomainPrivileges,
} from "./changes/domain.privilege.ts";
import type { DomainChange } from "./changes/domain.types.ts";
import type { Domain } from "./domain.model.ts";

/**
 * Diff two sets of domains from main and branch catalogs.
 *
 * @param ctx - Context containing version information.
 * @param main - The domains in the main catalog.
 * @param branch - The domains in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffDomains(
  ctx: {
    version: number;
    currentUser?: string;
    defaultPrivilegeState?: unknown;
  },
  main: Record<string, Domain>,
  branch: Record<string, Domain>,
): DomainChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: DomainChange[] = [];

  for (const domainId of created) {
    const newDomain = branch[domainId];
    changes.push(new CreateDomain({ domain: newDomain }));
    if (newDomain.comment !== null) {
      changes.push(new CreateCommentOnDomain({ domain: newDomain }));
    }
    // For unvalidated constraints, CREATE DOMAIN cannot specify NOT VALID.
    // Add them after creation and validate to match branch state semantics.
    // For already validated constraints, they are emitted inline in CREATE DOMAIN.
    if (newDomain.constraints && newDomain.constraints.length > 0) {
      for (const c of newDomain.constraints) {
        if (c.validated === false) {
          changes.push(
            new AlterDomainAddConstraint({ domain: newDomain, constraint: c }),
          );
          changes.push(
            new AlterDomainValidateConstraint({
              domain: newDomain,
              constraint: c,
            }),
          );
        }
      }
    }
  }

  for (const domainId of dropped) {
    changes.push(new DropDomain({ domain: main[domainId] }));
  }

  for (const domainId of altered) {
    const mainDomain = main[domainId];
    const branchDomain = branch[domainId];

    // DEFAULT
    if (mainDomain.default_value !== branchDomain.default_value) {
      if (branchDomain.default_value === null) {
        changes.push(new AlterDomainDropDefault({ domain: mainDomain }));
      } else {
        changes.push(
          new AlterDomainSetDefault({
            domain: mainDomain,
            defaultValue: branchDomain.default_value,
          }),
        );
      }
    }

    // NOT NULL
    if (mainDomain.not_null !== branchDomain.not_null) {
      if (branchDomain.not_null) {
        changes.push(new AlterDomainSetNotNull({ domain: mainDomain }));
      } else {
        changes.push(new AlterDomainDropNotNull({ domain: mainDomain }));
      }
    }

    // DOMAIN CONSTRAINTS
    const mainByName = new Map(mainDomain.constraints.map((c) => [c.name, c]));
    const branchByName = new Map(
      branchDomain.constraints.map((c) => [c.name, c]),
    );

    // Note: Constraint renames are modeled as drop+add because name is part
    // of the identity we diff on. No dedicated rename class is generated here.

    // Created
    for (const [name, c] of branchByName) {
      if (!mainByName.has(name)) {
        changes.push(
          new AlterDomainAddConstraint({
            domain: branchDomain,
            constraint: c,
          }),
        );
        if (!c.validated) {
          changes.push(
            new AlterDomainValidateConstraint({
              domain: branchDomain,
              constraint: c,
            }),
          );
        }
      }
    }

    // Dropped
    for (const [name, c] of mainByName) {
      if (!branchByName.has(name)) {
        changes.push(
          new AlterDomainDropConstraint({
            domain: mainDomain,
            constraint: c,
          }),
        );
      }
    }

    // Altered (drop + add for now)
    for (const [name, mainC] of mainByName) {
      const branchC = branchByName.get(name);
      if (!branchC) continue;
      const changed =
        mainC.validated !== branchC.validated ||
        mainC.is_local !== branchC.is_local ||
        mainC.no_inherit !== branchC.no_inherit ||
        mainC.check_expression !== branchC.check_expression;
      if (changed) {
        changes.push(
          new AlterDomainDropConstraint({
            domain: mainDomain,
            constraint: mainC,
          }),
        );
        changes.push(
          new AlterDomainAddConstraint({
            domain: branchDomain,
            constraint: branchC,
          }),
        );
        if (!branchC.validated) {
          changes.push(
            new AlterDomainValidateConstraint({
              domain: branchDomain,
              constraint: branchC,
            }),
          );
        }
      }
    }

    // OWNER
    if (mainDomain.owner !== branchDomain.owner) {
      changes.push(
        new AlterDomainChangeOwner({
          domain: mainDomain,
          owner: branchDomain.owner,
        }),
      );
    }

    // COMMENT
    if (mainDomain.comment !== branchDomain.comment) {
      if (branchDomain.comment === null) {
        changes.push(new DropCommentOnDomain({ domain: mainDomain }));
      } else {
        changes.push(new CreateCommentOnDomain({ domain: branchDomain }));
      }
    }

    // PRIVILEGES
    const privilegeResults = diffPrivileges(
      mainDomain.privileges,
      branchDomain.privileges,
    );

    for (const [grantee, result] of privilegeResults) {
      // Generate grant changes
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantDomainPrivileges({
              domain: branchDomain,
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
            new RevokeDomainPrivileges({
              domain: mainDomain,
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
          new RevokeGrantOptionDomainPrivileges({
            domain: mainDomain,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }
  }

  return changes;
}
