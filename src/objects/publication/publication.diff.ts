import { diffObjects } from "../base.diff.ts";
import { deepEqual } from "../utils.ts";
import {
  AlterPublicationAddSchemas,
  AlterPublicationAddTables,
  AlterPublicationDropSchemas,
  AlterPublicationDropTables,
  AlterPublicationSetForAllTables,
  AlterPublicationSetOptions,
  AlterPublicationSetOwner,
} from "./changes/publication.alter.ts";
import {
  CreateCommentOnPublication,
  DropCommentOnPublication,
} from "./changes/publication.comment.ts";
import { CreatePublication } from "./changes/publication.create.ts";
import { DropPublication } from "./changes/publication.drop.ts";
import type { PublicationChange } from "./changes/publication.types.ts";
import type {
  Publication,
  PublicationTableProps,
} from "./publication.model.ts";

export function diffPublications(
  ctx: { currentUser: string },
  main: Record<string, Publication>,
  branch: Record<string, Publication>,
): PublicationChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);
  const changes: PublicationChange[] = [];

  for (const id of created) {
    const publication = branch[id];
    changes.push(new CreatePublication({ publication }));

    // OWNER: If the publication should be owned by someone other than the current user,
    // emit ALTER PUBLICATION ... OWNER TO after creation
    if (publication.owner !== ctx.currentUser) {
      changes.push(
        new AlterPublicationSetOwner({
          publication,
          owner: publication.owner,
        }),
      );
    }

    if (publication.comment !== null) {
      changes.push(new CreateCommentOnPublication({ publication }));
    }
  }

  for (const id of dropped) {
    changes.push(new DropPublication({ publication: main[id] }));
  }

  for (const id of altered) {
    const mainPublication = main[id];
    const branchPublication = branch[id];

    if (mainPublication.all_tables && !branchPublication.all_tables) {
      changes.push(new DropPublication({ publication: mainPublication }));
      changes.push(new CreatePublication({ publication: branchPublication }));
      if (branchPublication.comment !== null) {
        changes.push(
          new CreateCommentOnPublication({ publication: branchPublication }),
        );
      }
      continue;
    }

    const operationsChanged =
      mainPublication.publish_insert !== branchPublication.publish_insert ||
      mainPublication.publish_update !== branchPublication.publish_update ||
      mainPublication.publish_delete !== branchPublication.publish_delete ||
      mainPublication.publish_truncate !== branchPublication.publish_truncate;

    const publishViaPartitionRootChanged =
      mainPublication.publish_via_partition_root !==
      branchPublication.publish_via_partition_root;

    if (operationsChanged || publishViaPartitionRootChanged) {
      changes.push(
        new AlterPublicationSetOptions({
          publication: branchPublication,
          setPublish: operationsChanged,
          setPublishViaPartitionRoot: publishViaPartitionRootChanged,
        }),
      );
    }

    let handledObjectLists = false;

    if (mainPublication.all_tables !== branchPublication.all_tables) {
      handledObjectLists = true;
      if (branchPublication.all_tables) {
        changes.push(
          new AlterPublicationSetForAllTables({
            publication: branchPublication,
          }),
        );
      } else {
        changes.push(new DropPublication({ publication: mainPublication }));
        changes.push(new CreatePublication({ publication: branchPublication }));
        if (branchPublication.comment !== null) {
          changes.push(
            new CreateCommentOnPublication({
              publication: branchPublication,
            }),
          );
        }
        continue;
      }
    }

    if (!handledObjectLists && !branchPublication.all_tables) {
      const tableDiff = diffPublicationTables(
        mainPublication.tables,
        branchPublication.tables,
      );
      if (tableDiff.tablesToDrop.length > 0) {
        changes.push(
          new AlterPublicationDropTables({
            publication: mainPublication,
            tables: tableDiff.tablesToDrop,
          }),
        );
      }
      if (tableDiff.tablesToAdd.length > 0) {
        changes.push(
          new AlterPublicationAddTables({
            publication: branchPublication,
            tables: tableDiff.tablesToAdd,
          }),
        );
      }

      const schemaDiff = diffPublicationSchemas(
        mainPublication.schemas,
        branchPublication.schemas,
      );
      if (schemaDiff.schemasToDrop.length > 0) {
        changes.push(
          new AlterPublicationDropSchemas({
            publication: mainPublication,
            schemas: schemaDiff.schemasToDrop,
          }),
        );
      }
      if (schemaDiff.schemasToAdd.length > 0) {
        changes.push(
          new AlterPublicationAddSchemas({
            publication: branchPublication,
            schemas: schemaDiff.schemasToAdd,
          }),
        );
      }
    }

    if (mainPublication.owner !== branchPublication.owner) {
      changes.push(
        new AlterPublicationSetOwner({
          publication: branchPublication,
          owner: branchPublication.owner,
        }),
      );
    }

    if (mainPublication.comment !== branchPublication.comment) {
      if (branchPublication.comment === null) {
        if (mainPublication.comment !== null) {
          changes.push(
            new DropCommentOnPublication({ publication: mainPublication }),
          );
        }
      } else {
        changes.push(
          new CreateCommentOnPublication({ publication: branchPublication }),
        );
      }
    }
  }

  return changes;
}

function diffPublicationTables(
  mainTables: PublicationTableProps[],
  branchTables: PublicationTableProps[],
) {
  const mainMap = new Map(
    mainTables.map((table) => [`${table.schema}.${table.name}`, table]),
  );
  const branchMap = new Map(
    branchTables.map((table) => [`${table.schema}.${table.name}`, table]),
  );

  const tablesToDropMap = new Map<string, PublicationTableProps>();
  const tablesToAddMap = new Map<string, PublicationTableProps>();

  for (const [key, mainTable] of mainMap) {
    if (!branchMap.has(key)) {
      tablesToDropMap.set(key, mainTable);
    }
  }

  for (const [key, branchTable] of branchMap) {
    const mainTable = mainMap.get(key);
    if (!mainTable) {
      tablesToAddMap.set(key, branchTable);
      continue;
    }

    const mainComparable = {
      columns: mainTable.columns,
      row_filter: mainTable.row_filter,
    };
    const branchComparable = {
      columns: branchTable.columns,
      row_filter: branchTable.row_filter,
    };

    if (!deepEqual(mainComparable, branchComparable)) {
      tablesToDropMap.set(key, mainTable);
      tablesToAddMap.set(key, branchTable);
    }
  }

  const tablesToDrop = Array.from(tablesToDropMap.values()).sort((a, b) => {
    return a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name);
  });
  const tablesToAdd = Array.from(tablesToAddMap.values()).sort((a, b) => {
    return a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name);
  });

  return { tablesToDrop, tablesToAdd };
}

function diffPublicationSchemas(
  mainSchemas: string[],
  branchSchemas: string[],
) {
  const mainSet = new Set(mainSchemas);
  const branchSet = new Set(branchSchemas);

  const schemasToDrop = [...mainSet.difference(branchSet)].sort((a, b) =>
    a.localeCompare(b),
  );
  const schemasToAdd = [...branchSet.difference(mainSet)].sort((a, b) =>
    a.localeCompare(b),
  );

  return { schemasToDrop, schemasToAdd };
}
