import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { Index } from "../index.model.ts";
import { CreateIndex } from "./index.create.ts";
import { DropIndex } from "./index.drop.ts";

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
  | AlterIndexSetStorageParams
  | AlterIndexSetStatistics
  | AlterIndexSetTablespace;

/**
 * ALTER INDEX ... SET ( storage_parameter = value [, ... ] )
 */
export class AlterIndexSetStorageParams extends AlterChange {
  public readonly main: Index;
  public readonly branch: Index;

  constructor(props: { main: Index; branch: Index }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const storageParams = this.branch.storage_params
      .map((param) => param)
      .join(", ");

    return [
      "ALTER INDEX",
      quoteIdentifier(this.main.table_schema),
      ".",
      quoteIdentifier(this.main.table_name),
      ".",
      quoteIdentifier(this.main.name),
      "SET (",
      storageParams,
      ")",
    ].join(" ");
  }
}

/**
 * ALTER INDEX ... SET STATISTICS ...
 */
export class AlterIndexSetStatistics extends AlterChange {
  public readonly main: Index;
  public readonly branch: Index;

  constructor(props: { main: Index; branch: Index }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const statisticsTarget = this.branch.statistics_target[0]; // Assuming single value for now

    return [
      "ALTER INDEX",
      quoteIdentifier(this.main.table_schema),
      ".",
      quoteIdentifier(this.main.table_name),
      ".",
      quoteIdentifier(this.main.name),
      "SET STATISTICS",
      statisticsTarget.toString(),
    ].join(" ");
  }
}

/**
 * ALTER INDEX ... SET TABLESPACE ...
 */
export class AlterIndexSetTablespace extends AlterChange {
  public readonly main: Index;
  public readonly branch: Index;

  constructor(props: { main: Index; branch: Index }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    return [
      "ALTER INDEX",
      `${quoteIdentifier(this.main.table_schema)}.${quoteIdentifier(this.main.table_name)}.${quoteIdentifier(this.main.name)}`,
      "SET TABLESPACE",
      // biome-ignore lint/style/noNonNullAssertion: the tablespace is set in this case
      quoteIdentifier(this.branch.tablespace!),
    ].join(" ");
  }
}

/**
 * Replace an index by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER INDEX change.
 */
export class ReplaceIndex extends ReplaceChange {
  public readonly main: Index;
  public readonly branch: Index;

  constructor(props: { main: Index; branch: Index }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const dropChange = new DropIndex({ index: this.main });
    const createChange = new CreateIndex({ index: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
