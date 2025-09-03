import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { TableLikeObject } from "../../base.model.ts";
import type { Index } from "../index.model.ts";
import { CreateIndex } from "./index.create.ts";
import { DropIndex } from "./index.drop.ts";
import { checkIsSerializable } from "./utils.ts";

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

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const parseOptions = (options: string[]) => {
      const map = new Map<string, string>();
      for (const opt of options) {
        const eqIndex = opt.indexOf("=");
        const key = opt.slice(0, eqIndex);
        const value = opt.slice(eqIndex + 1);
        map.set(key, value);
      }
      return map;
    };

    const mainMap = parseOptions(this.main.storage_params);
    const branchMap = parseOptions(this.branch.storage_params);

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
        paramsToSet.push(`${key}=${newValue}`);
      }
    }

    const head = [
      "ALTER INDEX",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
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

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const statements: string[] = [];
    const head = [
      "ALTER INDEX",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
    ].join(" ");

    const mainTargets = this.main.statistics_target;
    const branchTargets = this.branch.statistics_target;
    const length = Math.max(mainTargets.length, branchTargets.length);

    for (let i = 0; i < length; i++) {
      const oldVal = mainTargets[i];
      const newVal = branchTargets[i];
      if (oldVal !== newVal && newVal !== undefined) {
        const colNumber = i + 1; // PostgreSQL column_number is 1-based
        statements.push(
          `${head} ALTER COLUMN ${colNumber} SET STATISTICS ${newVal.toString()}`,
        );
      }
    }

    return statements.join(";\n");
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

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER INDEX",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
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
  public readonly indexableObject?: TableLikeObject;

  constructor(props: {
    main: Index;
    branch: Index;
    indexableObject?: TableLikeObject;
  }) {
    super();
    checkIsSerializable(props.branch, props.indexableObject);
    this.main = props.main;
    this.branch = props.branch;
    this.indexableObject = props.indexableObject;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropIndex({ index: this.main });
    const createChange = new CreateIndex({
      index: this.branch,
      indexableObject: this.indexableObject,
    });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
