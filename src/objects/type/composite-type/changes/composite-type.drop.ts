import { DropChange } from "../../../base.change.ts";
import type { CompositeType } from "../composite-type.model.ts";

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
export class DropCompositeType extends DropChange {
  public readonly compositeType: CompositeType;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get stableId(): string {
    return `${this.compositeType.stableId}`;
  }

  serialize(): string {
    return [
      "DROP TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
    ].join(" ");
  }
}
