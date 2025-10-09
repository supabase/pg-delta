import { BaseChange } from "../../base.change.ts";
import type { Index } from "../index.model.ts";
import { AlterIndexChange } from "./index.base.ts";

/**
 * Alter an index.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterindex.html
 *
 * Synopsis
 * ```sql
 * ALTER INDEX [ CONCURRENTLY ] [ IF EXISTS ] name SET TABLESPACE tablespace_name
 * ALTER INDEX [ CONCURRENTLY ] [ IF EXISTS ] name SET ( storage_parameter = value [, ... ] )
 * ALTER INDEX [ CONCURRENTLY ] [ IF EXISTS ] name RESET ( storage_parameter [, ... ] )
 * ALTER INDEX [ CONCURRENTLY ] [ IF EXISTS ] name SET STATISTICS integer
 * ALTER INDEX [ CONCURRENTLY ] [ IF EXISTS ] name ALTER [ COLUMN ] column_number SET STATISTICS integer
 * ```
 */

export type AlterIndex =
  | AlterIndexSetStatistics
  | AlterIndexSetStorageParams
  | AlterIndexSetTablespace;

/**
 * ALTER INDEX ... SET ( storage_parameter = value [, ... ] )
 */
export class AlterIndexSetStorageParams extends AlterIndexChange {
  public readonly index: Index;
  public readonly paramsToSet: string[];
  public readonly keysToReset: string[];
  public readonly scope = "object" as const;

  constructor(props: {
    index: Index;
    paramsToSet: string[];
    keysToReset: string[];
  }) {
    super();
    this.index = props.index;
    this.paramsToSet = props.paramsToSet;
    this.keysToReset = props.keysToReset;
  }

  get dependencies() {
    return [this.index.stableId];
  }

  serialize(): string {
    const head = [
      "ALTER INDEX",
      `${this.index.schema}.${this.index.name}`,
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
 * ALTER INDEX ... SET STATISTICS ...
 */
export class AlterIndexSetStatistics extends BaseChange {
  public readonly index: Index;
  public readonly columnTargets: Array<{
    columnNumber: number;
    statistics: number;
  }>;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "index" as const;

  constructor(props: {
    index: Index;
    columnTargets: Array<{ columnNumber: number; statistics: number }>;
  }) {
    super();
    this.index = props.index;
    this.columnTargets = props.columnTargets;
  }

  get dependencies() {
    return [this.index.stableId];
  }

  serialize(): string {
    const statements: string[] = [];
    const head = [
      "ALTER INDEX",
      `${this.index.schema}.${this.index.name}`,
    ].join(" ");

    for (const { columnNumber, statistics } of this.columnTargets) {
      statements.push(
        `${head} ALTER COLUMN ${columnNumber} SET STATISTICS ${statistics.toString()}`,
      );
    }

    return statements.join(";\n");
  }
}

/**
 * ALTER INDEX ... SET TABLESPACE ...
 */
export class AlterIndexSetTablespace extends BaseChange {
  public readonly index: Index;
  public readonly tablespace: string;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "index" as const;

  constructor(props: { index: Index; tablespace: string }) {
    super();
    this.index = props.index;
    this.tablespace = props.tablespace;
  }

  get dependencies() {
    return [this.index.stableId];
  }

  serialize(): string {
    return [
      "ALTER INDEX",
      `${this.index.schema}.${this.index.name}`,
      "SET TABLESPACE",
      this.tablespace,
    ].join(" ");
  }
}

/**
 * Replace an index by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER INDEX change.
 */
// NOTE: ReplaceIndex removed. Non-alterable changes are emitted as DropIndex + CreateIndex in index.diff.ts.
