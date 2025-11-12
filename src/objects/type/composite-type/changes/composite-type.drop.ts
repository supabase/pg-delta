import type { CompositeType } from "../composite-type.model.ts";
import { DropCompositeTypeChange } from "./composite-type.base.ts";

/**
 * Drop a composite type.
 *
 * @see https://www.postgresql.org/docs/17/sql-droptype.html
 *
 * Synopsis
 * ```sql
 * DROP TYPE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropCompositeType extends DropCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly scope = "object" as const;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get drops() {
    return [this.compositeType.stableId];
  }

  get requires() {
    return [this.compositeType.stableId];
  }

  serialize(): string {
    return [
      "DROP TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
    ].join(" ");
  }
}
