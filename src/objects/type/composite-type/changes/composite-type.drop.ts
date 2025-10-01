import { Change } from "../../../base.change.ts";
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
export class DropCompositeType extends Change {
  public readonly compositeType: CompositeType;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "composite_type" as const;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get dependencies() {
    return [this.compositeType.stableId];
  }

  serialize(): string {
    return [
      "DROP TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
    ].join(" ");
  }
}
