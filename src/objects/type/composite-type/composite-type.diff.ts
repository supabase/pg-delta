import type { Change } from "../../base.change.ts";
import { diffObjects } from "../../base.diff.ts";
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
import type { CompositeType } from "./composite-type.model.ts";

/**
 * Diff two sets of composite types from main and branch catalogs.
 *
 * @param main - The composite types in the main catalog.
 * @param branch - The composite types in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffCompositeTypes(
  main: Record<string, CompositeType>,
  branch: Record<string, CompositeType>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const compositeTypeId of created) {
    const ct = branch[compositeTypeId];
    changes.push(new CreateCompositeType({ compositeType: ct }));
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
            main: mainCompositeType,
            branch: branchCompositeType,
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

      // Note: Composite type renaming would also use ALTER TYPE ... RENAME TO ...
      // But since our CompositeType model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
