import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import { AlterRoleSetOptions, ReplaceRole } from "./changes/role.alter.ts";
import { CreateRole } from "./changes/role.create.ts";
import { DropRole } from "./changes/role.drop.ts";
import type { Role } from "./role.model.ts";

/**
 * Diff two sets of roles from main and branch catalogs.
 *
 * @param main - The roles in the main catalog.
 * @param branch - The roles in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffRoles(
  main: Record<string, Role>,
  branch: Record<string, Role>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const roleId of created) {
    changes.push(new CreateRole({ role: branch[roleId] }));
  }

  for (const roleId of dropped) {
    changes.push(new DropRole({ role: main[roleId] }));
  }

  for (const roleId of altered) {
    const mainRole = main[roleId];
    const branchRole = branch[roleId];

    // config cannot be altered in our current scope; replace when changes
    const NON_ALTERABLE_FIELDS: Array<keyof Role> = ["config"];
    const shouldReplace = hasNonAlterableChanges(
      mainRole,
      branchRole,
      NON_ALTERABLE_FIELDS,
    );

    if (shouldReplace) {
      changes.push(new ReplaceRole({ main: mainRole, branch: branchRole }));
    } else {
      // Use ALTER for flag and connection limit changes
      changes.push(
        new AlterRoleSetOptions({ main: mainRole, branch: branchRole }),
      );
    }
  }

  return changes;
}
