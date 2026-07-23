import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  emitObjectPrivilegeChanges,
  withPublicBuiltInDefault,
} from "../base.privilege-diff.ts";
import type { ObjectDiffContext } from "../diff-context.ts";
import { diffSecurityLabels } from "../security-label.types.ts";
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
import {
  CreateSecurityLabelOnDomain,
  DropSecurityLabelOnDomain,
} from "./changes/domain.security-label.ts";
import type { DomainChange } from "./changes/domain.types.ts";
import type { Domain } from "./domain.model.ts";

/**
 * Diff two sets of domains from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The domains in the main catalog.
 * @param branch - The domains in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffDomains(
  ctx: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >,
  main: Record<string, Domain>,
  branch: Record<string, Domain>,
): DomainChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: DomainChange[] = [];

  for (const domainId of created) {
    const newDomain = branch[domainId];
    changes.push(new CreateDomain({ domain: newDomain }));

    // OWNER: If the domain should be owned by someone other than the current user,
    // emit ALTER DOMAIN ... OWNER TO after creation
    if (newDomain.owner !== ctx.currentUser) {
      changes.push(
        new AlterDomainChangeOwner({
          domain: newDomain,
          owner: newDomain.owner,
        }),
      );
    }

    if (newDomain.comment !== null) {
      changes.push(new CreateCommentOnDomain({ domain: newDomain }));
    }
    for (const label of newDomain.security_labels) {
      changes.push(
        new CreateSecurityLabelOnDomain({
          domain: newDomain,
          securityLabel: label,
        }),
      );
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

    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "domain",
      newDomain.schema ?? "",
    );
    const creatorFilteredDefaults =
      newDomain.owner !== ctx.currentUser
        ? effectiveDefaults.filter((p) => p.grantee !== ctx.currentUser)
        : effectiveDefaults;
    // newDomain.privileges is the desired object's real ACL, which already
    // reflects PostgreSQL's implicit PUBLIC USAGE default (or its absence, if
    // explicitly revoked). Compare it unfiltered against the defaults side
    // with that same built-in default added back in, so both sides are
    // symmetric.
    const desiredPrivileges = newDomain.privileges;
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use the domain owner as the reference.
    const privilegeResults = diffPrivileges(
      withPublicBuiltInDefault("domain", creatorFilteredDefaults),
      desiredPrivileges,
      newDomain.owner,
    );

    changes.push(
      ...(emitObjectPrivilegeChanges(
        privilegeResults,
        newDomain,
        newDomain,
        "domain",
        {
          Grant: GrantDomainPrivileges,
          Revoke: RevokeDomainPrivileges,
          RevokeGrantOption: RevokeGrantOptionDomainPrivileges,
        },
        ctx.version,
      ) as DomainChange[]),
    );
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

    // SECURITY LABELS
    changes.push(
      ...diffSecurityLabels<
        CreateSecurityLabelOnDomain | DropSecurityLabelOnDomain
      >(
        mainDomain.security_labels,
        branchDomain.security_labels,
        (securityLabel) =>
          new CreateSecurityLabelOnDomain({
            domain: branchDomain,
            securityLabel,
          }),
        (securityLabel) =>
          new DropSecurityLabelOnDomain({
            domain: mainDomain,
            securityLabel,
          }),
      ),
    );

    // PRIVILEGES
    // Both mainDomain.privileges and branchDomain.privileges are extracted via
    // COALESCE(<acl-column>, acldefault(...)), so PostgreSQL's implicit
    // PUBLIC USAGE default is already correctly represented (or absent, if
    // explicitly revoked) on both sides. Diff them unfiltered.
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use branch owner as the reference.
    const privilegeResults = diffPrivileges(
      mainDomain.privileges,
      branchDomain.privileges,
      branchDomain.owner,
    );

    changes.push(
      ...(emitObjectPrivilegeChanges(
        privilegeResults,
        branchDomain,
        mainDomain,
        "domain",
        {
          Grant: GrantDomainPrivileges,
          Revoke: RevokeDomainPrivileges,
          RevokeGrantOption: RevokeGrantOptionDomainPrivileges,
        },
        ctx.version,
      ) as DomainChange[]),
    );
  }

  return changes;
}
