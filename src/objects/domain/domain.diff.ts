import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
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
import { CreateDomain } from "./changes/domain.create.ts";
import { DropDomain } from "./changes/domain.drop.ts";
import type { Domain } from "./domain.model.ts";

/**
 * Diff two sets of domains from main and branch catalogs.
 *
 * @param main - The domains in the main catalog.
 * @param branch - The domains in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffDomains(
  main: Record<string, Domain>,
  branch: Record<string, Domain>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const domainId of created) {
    changes.push(new CreateDomain({ domain: branch[domainId] }));
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
        changes.push(
          new AlterDomainDropDefault({
            main: mainDomain,
            branch: branchDomain,
          }),
        );
      } else {
        changes.push(
          new AlterDomainSetDefault({ main: mainDomain, branch: branchDomain }),
        );
      }
    }

    // NOT NULL
    if (mainDomain.not_null !== branchDomain.not_null) {
      if (branchDomain.not_null) {
        changes.push(
          new AlterDomainSetNotNull({ main: mainDomain, branch: branchDomain }),
        );
      } else {
        changes.push(
          new AlterDomainDropNotNull({
            main: mainDomain,
            branch: branchDomain,
          }),
        );
      }
    }

    // DOMAIN CONSTRAINTS
    if (mainDomain.constraints || branchDomain.constraints) {
      const mainByName = new Map(
        (mainDomain.constraints ?? []).map((c) => [c.name, c]),
      );
      const branchByName = new Map(
        (branchDomain.constraints ?? []).map((c) => [c.name, c]),
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
          mainC.check_expression !== branchC.check_expression ||
          mainC.owner !== branchC.owner;
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
    }

    // OWNER
    if (mainDomain.owner !== branchDomain.owner) {
      changes.push(
        new AlterDomainChangeOwner({ main: mainDomain, branch: branchDomain }),
      );
    }
  }

  return changes;
}
