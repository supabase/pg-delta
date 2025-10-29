import type { CompositeType } from "../composite-type.model.ts";
import { CreateCompositeTypeChange } from "./composite-type.base.ts";

/**
 * Create a composite type.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtype.html
 *
 * Synopsis
 * ```sql
 * CREATE TYPE name AS
 *     ( [ attribute_name data_type [ COLLATE collation ] [, ... ] ] )
 * ```
 */
export class CreateCompositeType extends CreateCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly scope = "object" as const;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get creates() {
    return [this.compositeType.stableId];
  }

  serialize(): string {
    const parts: string[] = ["CREATE TYPE"];

    // Add schema and name
    parts.push(`${this.compositeType.schema}.${this.compositeType.name}`);

    // Add AS keyword
    parts.push("AS");

    parts.push(
      `(${this.compositeType.columns
        .map((column) => {
          const tokens: string[] = [];
          // attribute name and data type
          tokens.push(column.name);
          tokens.push(column.data_type_str);
          // Collation (only when non-default, already filtered by extractor)
          if (column.collation) {
            tokens.push("COLLATE", column.collation);
          }
          return tokens.join(" ");
        })
        .join(", ")})`,
    );

    return parts.join(" ");
  }
}
