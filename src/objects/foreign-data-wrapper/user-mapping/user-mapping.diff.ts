import { diffObjects } from "../../base.diff.ts";
import { AlterUserMappingSetOptions } from "./changes/user-mapping.alter.ts";
import { CreateUserMapping } from "./changes/user-mapping.create.ts";
import { DropUserMapping } from "./changes/user-mapping.drop.ts";
import type { UserMappingChange } from "./changes/user-mapping.types.ts";
import type { UserMapping } from "./user-mapping.model.ts";

/**
 * Diff two sets of user mappings from main and branch catalogs.
 *
 * @param main - The user mappings in the main catalog.
 * @param branch - The user mappings in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffUserMappings(
  main: Record<string, UserMapping>,
  branch: Record<string, UserMapping>,
): UserMappingChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: UserMappingChange[] = [];

  for (const mappingId of created) {
    const createdMapping = branch[mappingId];
    changes.push(new CreateUserMapping({ userMapping: createdMapping }));
  }

  for (const mappingId of dropped) {
    changes.push(new DropUserMapping({ userMapping: main[mappingId] }));
  }

  for (const mappingId of altered) {
    const mainMapping = main[mappingId];
    const branchMapping = branch[mappingId];

    // OPTIONS
    const optionsChanged = diffOptions(
      mainMapping.options,
      branchMapping.options,
    );
    if (optionsChanged.length > 0) {
      changes.push(
        new AlterUserMappingSetOptions({
          userMapping: mainMapping,
          options: optionsChanged,
        }),
      );
    }
  }

  return changes;
}

/**
 * Diff options arrays to determine ADD/SET/DROP operations.
 * Options are stored as [key1, value1, key2, value2, ...]
 */
function diffOptions(
  mainOptions: string[] | null,
  branchOptions: string[] | null,
): Array<{ action: "ADD" | "SET" | "DROP"; option: string; value?: string }> {
  const mainMap = new Map<string, string>();
  const branchMap = new Map<string, string>();

  // Parse main options
  if (mainOptions) {
    for (let i = 0; i < mainOptions.length; i += 2) {
      if (i + 1 < mainOptions.length) {
        mainMap.set(mainOptions[i], mainOptions[i + 1]);
      }
    }
  }

  // Parse branch options
  if (branchOptions) {
    for (let i = 0; i < branchOptions.length; i += 2) {
      if (i + 1 < branchOptions.length) {
        branchMap.set(branchOptions[i], branchOptions[i + 1]);
      }
    }
  }

  const changes: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }> = [];

  // Find options to ADD or SET
  for (const [key, value] of branchMap) {
    const mainValue = mainMap.get(key);
    if (mainValue === undefined) {
      changes.push({ action: "ADD", option: key, value });
    } else if (mainValue !== value) {
      changes.push({ action: "SET", option: key, value });
    }
  }

  // Find options to DROP
  for (const [key] of mainMap) {
    if (!branchMap.has(key)) {
      changes.push({ action: "DROP", option: key });
    }
  }

  return changes;
}
