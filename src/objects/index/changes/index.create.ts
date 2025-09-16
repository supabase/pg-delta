import { CreateChange } from "../../base.change.ts";
import type { TableLikeObject } from "../../base.model.ts";
import type { Index } from "../index.model.ts";
import { checkIsSerializable } from "./utils.ts";

/**
 * Create an index.
 *
 * @see https://www.postgresql.org/docs/17/sql-createindex.html
 *
 * Synopsis
 * ```sql
 * CREATE [ UNIQUE ] INDEX [ CONCURRENTLY ] [ [ IF NOT EXISTS ] name ] ON [ ONLY ] table_name [ USING method ]
 *     ( { column_name | ( expression ) } [ COLLATE collation ] [ opclass [ ( opclass_parameter = value [, ... ] ) ] ] [ ASC | DESC ] [ NULLS { FIRST | LAST } ] [, ...] )
 *     [ INCLUDE ( column_name [, ...] ) ]
 *     [ WITH ( storage_parameter [= value] [, ... ] ) ]
 *     [ TABLESPACE tablespace_name ]
 *     [ WHERE predicate ]
 * ```
 */

export class CreateIndex extends CreateChange {
  public readonly index: Index;
  public readonly indexableObject?: TableLikeObject;

  constructor(props: { index: Index; indexableObject?: TableLikeObject }) {
    super();
    checkIsSerializable(props.index, props.indexableObject);
    this.index = props.index;
    this.indexableObject = props.indexableObject;
  }

  get dependencies() {
    return [this.index.stableId];
  }

  serialize(): string {
    return this.index.definition;
  }
}
