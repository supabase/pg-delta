import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { AlterSchemaChangeOwner } from "./changes/schema.alter.ts";
import { CreateSchema } from "./changes/schema.create.ts";
import { DropSchema } from "./changes/schema.drop.ts";
import type { Schema } from "./schema.model.ts";

/**
 * Diff two sets of schemas from main and branch catalogs.
 *
 * @param main - The schemas in the main catalog.
 * @param branch - The schemas in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffSchemas(
  main: Record<string, Schema>,
  branch: Record<string, Schema>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const schemaId of created) {
    changes.push(new CreateSchema({ schema: branch[schemaId] }));
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
          main: mainSchema,
          branch: branchSchema,
        }),
      );
    }

    // Note: Schema renaming would also use ALTER SCHEMA ... RENAME TO ...
    // But since our Schema model uses 'schema' as the identity field,
    // a name change would be handled as drop + create by diffObjects()
  }

  return changes;
}
