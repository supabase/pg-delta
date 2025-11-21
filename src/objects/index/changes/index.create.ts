import type { TableLikeObject } from "../../base.model.ts";
import { stableId } from "../../utils.ts";
import type { Index } from "../index.model.ts";
import { CreateIndexChange } from "./index.base.ts";
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

export class CreateIndex extends CreateIndexChange {
  public readonly index: Index;
  public readonly indexableObject?: TableLikeObject;
  public readonly scope = "object" as const;

  constructor(props: { index: Index; indexableObject?: TableLikeObject }) {
    super();
    checkIsSerializable(props.index, props.indexableObject);
    this.index = props.index;
    this.indexableObject = props.indexableObject;
  }

  get creates() {
    return [this.index.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.index.schema));

    // Table dependency
    dependencies.add(stableId.table(this.index.schema, this.index.table_name));

    // Owner dependency
    dependencies.add(stableId.role(this.index.owner));

    return Array.from(dependencies);
  }

  serialize(): string {
    // btree being the default, we can omit it
    return this.index.definition.replace(" USING btree", "");
  }
}
