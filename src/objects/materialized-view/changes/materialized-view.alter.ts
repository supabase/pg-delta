import type { MaterializedView } from "../materialized-view.model.ts";
import { AlterMaterializedViewChange } from "./materialized-view.base.ts";

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
 *
 * Notes for diff-based generation:
 * - We currently only emit OWNER TO when owner differs.
 * - Name/schema changes are treated as identity changes; handled as drop/create by the diff engine.
 * - Column attribute changes, CLUSTER are not modeled and thus not emitted.
 * - Changes to definition, options, and other non-alterable properties trigger a replace (drop + create).
 */

export type AlterMaterializedView =
  | AlterMaterializedViewChangeOwner
  | AlterMaterializedViewSetStorageParams;

/**
 * ALTER MATERIALIZED VIEW ... OWNER TO ...
 */
export class AlterMaterializedViewChangeOwner extends AlterMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { materializedView: MaterializedView; owner: string }) {
    super();
    this.materializedView = props.materializedView;
    this.owner = props.owner;
  }

  get requires() {
    return [this.materializedView.stableId];
  }

  serialize(): string {
    return [
      "ALTER MATERIALIZED VIEW",
      `${this.materializedView.schema}.${this.materializedView.name}`,
      "OWNER TO",
      this.owner,
    ].join(" ");
  }
}

/**
 * ALTER MATERIALIZED VIEW ... SET/RESET ( storage_parameter ... )
 * Accepts main and branch, computes differences, and emits RESET then SET statements.
 */
export class AlterMaterializedViewSetStorageParams extends AlterMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly paramsToSet: string[];
  public readonly keysToReset: string[];
  public readonly scope = "object" as const;

  constructor(props: {
    materializedView: MaterializedView;
    paramsToSet: string[];
    keysToReset: string[];
  }) {
    super();
    this.materializedView = props.materializedView;
    this.paramsToSet = props.paramsToSet;
    this.keysToReset = props.keysToReset;
  }

  get requires() {
    return [this.materializedView.stableId];
  }

  serialize(): string {
    const head = [
      "ALTER MATERIALIZED VIEW",
      `${this.materializedView.schema}.${this.materializedView.name}`,
    ].join(" ");

    const statements: string[] = [];
    if (this.keysToReset.length > 0) {
      statements.push(`${head} RESET (${this.keysToReset.join(", ")})`);
    }
    if (this.paramsToSet.length > 0) {
      statements.push(`${head} SET (${this.paramsToSet.join(", ")})`);
    }

    return statements.join(";\n");
  }
}

/**
 * Replace a materialized view by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER MATERIALIZED VIEW change.
 */
// NOTE: ReplaceMaterializedView removed. Non-alterable changes are emitted as Drop + Create in materialized-view.diff.ts.
