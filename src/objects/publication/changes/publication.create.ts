import { stableId } from "../../utils.ts";
import type { Publication } from "../publication.model.ts";
import {
  formatPublicationObjects,
  getPublicationOperations,
  isDefaultPublicationOperations,
} from "../utils.ts";
import { CreatePublicationChange } from "./publication.base.ts";

/**
 * Create a logical replication publication.
 *
 * @see https://www.postgresql.org/docs/17/sql-createpublication.html
 */
export class CreatePublication extends CreatePublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;

  constructor(props: { publication: Publication }) {
    super();
    this.publication = props.publication;
  }

  get creates() {
    return [this.publication.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    dependencies.add(stableId.role(this.publication.owner));

    if (!this.publication.all_tables) {
      for (const table of this.publication.tables) {
        dependencies.add(stableId.table(table.schema, table.name));
        if (table.columns) {
          for (const column of table.columns) {
            dependencies.add(stableId.column(table.schema, table.name, column));
          }
        }
      }

      for (const schema of this.publication.schemas) {
        dependencies.add(stableId.schema(schema));
      }
    }

    return Array.from(dependencies);
  }

  serialize(): string {
    const parts: string[] = ["CREATE PUBLICATION", this.publication.name];

    if (this.publication.all_tables) {
      parts.push("FOR ALL TABLES");
    } else {
      const objectClauses = formatPublicationObjects(
        this.publication.tables,
        this.publication.schemas,
      );
      if (objectClauses.length > 0) {
        parts.push("FOR", objectClauses.join(", "));
      }
    }

    const options: string[] = [];
    if (!isDefaultPublicationOperations(this.publication)) {
      const operations = getPublicationOperations(this.publication);
      options.push(`publish = '${operations.join(", ")}'`);
    }

    if (this.publication.publish_via_partition_root) {
      options.push("publish_via_partition_root = true");
    }

    if (options.length > 0) {
      parts.push("WITH", `(${options.join(", ")})`);
    }

    return parts.join(" ");
  }
}
