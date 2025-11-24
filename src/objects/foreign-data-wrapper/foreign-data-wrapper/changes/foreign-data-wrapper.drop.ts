import type { ForeignDataWrapper } from "../foreign-data-wrapper.model.ts";
import { DropForeignDataWrapperChange } from "./foreign-data-wrapper.base.ts";

/**
 * Drop a foreign data wrapper.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropforeigndatawrapper.html
 *
 * Synopsis
 * ```sql
 * DROP FOREIGN DATA WRAPPER [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropForeignDataWrapper extends DropForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly scope = "object" as const;

  constructor(props: { foreignDataWrapper: ForeignDataWrapper }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
  }

  get drops() {
    return [this.foreignDataWrapper.stableId];
  }

  get requires() {
    return [this.foreignDataWrapper.stableId];
  }

  serialize(): string {
    return ["DROP FOREIGN DATA WRAPPER", this.foreignDataWrapper.name].join(
      " ",
    );
  }
}
