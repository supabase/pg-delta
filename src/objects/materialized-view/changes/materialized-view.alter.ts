import { AlterChange, ReplaceChange } from "../../base.change.ts";
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
 *
 * Notes for diff-based generation:
 * - We currently only emit OWNER TO when owner differs.
 * - Name/schema changes are treated as identity changes; handled as drop/create by the diff engine.
 * - Column attribute changes, CLUSTER are not modeled and thus not emitted.
 * - Changes to definition, options, and other non-alterable properties trigger a replace (drop + create).
 */
type AlterMaterializedView =
  | AlterMaterializedViewChangeOwner
  | AlterMaterializedViewSetStorageParams;

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

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER MATERIALIZED VIEW",
      `${this.main.schema}.${this.main.name}`,
      "OWNER TO",
      this.branch.owner,
    ].join(" ");
  }
}

/**
 * ALTER MATERIALIZED VIEW ... SET/RESET ( storage_parameter ... )
 * Accepts main and branch, computes differences, and emits RESET then SET statements.
 */
export class AlterMaterializedViewSetStorageParams extends AlterChange {
  public readonly main: MaterializedView;
  public readonly branch: MaterializedView;

  constructor(props: { main: MaterializedView; branch: MaterializedView }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const parseOptions = (options: string[] | null | undefined) => {
      const map = new Map<string, string>();
      if (!options) return map;
      for (const opt of options) {
        const eqIndex = opt.indexOf("=");
        const key = opt.slice(0, eqIndex).trim();
        const value = opt.slice(eqIndex + 1).trim();
        map.set(key, value);
      }
      return map;
    };

    const mainMap = parseOptions(this.main.options);
    const branchMap = parseOptions(this.branch.options);

    const keysToReset: string[] = [];
    for (const key of mainMap.keys()) {
      if (!branchMap.has(key)) {
        keysToReset.push(key);
      }
    }

    const paramsToSet: string[] = [];
    for (const [key, newValue] of branchMap.entries()) {
      const oldValue = mainMap.get(key);
      const changed = oldValue !== newValue;
      if (changed) {
        paramsToSet.push(newValue === undefined ? key : `${key}=${newValue}`);
      }
    }

    const head = [
      "ALTER MATERIALIZED VIEW",
      `${this.main.schema}.${this.main.name}`,
    ].join(" ");

    const statements: string[] = [];
    if (keysToReset.length > 0) {
      statements.push(`${head} RESET (${keysToReset.join(", ")})`);
    }
    if (paramsToSet.length > 0) {
      statements.push(`${head} SET (${paramsToSet.join(", ")})`);
    }

    return statements.join(";\n");
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

  get stableId(): string {
    return `${this.main.stableId}`;
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
