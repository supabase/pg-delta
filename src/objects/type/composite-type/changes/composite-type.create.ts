import { Change } from "../../../base.change.ts";
import type { CompositeType } from "../composite-type.model.ts";

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
export class CreateCompositeType extends Change {
  public readonly compositeType: CompositeType;
  public readonly operation = "create" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "composite_type" as const;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get dependencies() {
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
