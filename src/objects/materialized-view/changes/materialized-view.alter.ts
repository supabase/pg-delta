import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { MaterializedView } from "../materialized-view.model.ts";
import { CreateMaterializedView } from "./materialized-view.create.ts";
import { DropMaterializedView } from "./materialized-view.drop.ts";

/**
 * Alter a materialized view.
 *
 * @see https://www.postgresql.org/docs/17/sql-altermaterializedview.html
 *
 * Synopsis
 * ```sql
 * ALTER MATERIALIZED VIEW [ IF EXISTS ] name
 *     action [, ... ]
 * where action is one of:
 *     ALTER [ COLUMN ] column_name SET STATISTICS integer
 *     ALTER [ COLUMN ] column_name SET ( attribute_option = value [, ... ] )
 *     ALTER [ COLUMN ] column_name RESET ( attribute_option [, ... ] )
 *     ALTER [ COLUMN ] column_name SET STORAGE { PLAIN | EXTERNAL | EXTENDED | MAIN }
 *     CLUSTER ON index_name
 *     SET WITHOUT CLUSTER
 *     SET ( storage_parameter [= value] [, ... ] )
 *     RESET ( storage_parameter [, ... ] )
 *     OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 *     RENAME TO new_name
 *     SET SCHEMA new_schema
 * ```
 */
export type AlterMaterializedView = AlterMaterializedViewChangeOwner;

/**
 * ALTER MATERIALIZED VIEW ... OWNER TO ...
 */
export class AlterMaterializedViewChangeOwner extends AlterChange {
  public readonly main: MaterializedView;
  public readonly branch: MaterializedView;

  constructor(props: { main: MaterializedView; branch: MaterializedView }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    return [
      "ALTER MATERIALIZED VIEW",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "OWNER TO",
      quoteIdentifier(this.branch.owner),
    ].join(" ");
  }
}

/**
 * Replace a materialized view by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER MATERIALIZED VIEW change.
 */
export class ReplaceMaterializedView extends ReplaceChange {
  public readonly main: MaterializedView;
  public readonly branch: MaterializedView;

  constructor(props: { main: MaterializedView; branch: MaterializedView }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const dropChange = new DropMaterializedView({
      materializedView: this.main,
    });
    const createChange = new CreateMaterializedView({
      materializedView: this.branch,
    });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
