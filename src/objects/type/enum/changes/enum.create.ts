import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { Enum } from "../enum.model.ts";
import { CreateEnumChange } from "./enum.base.ts";

/**
 * Create an enum.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtype.html
 *
 * Synopsis
 * ```sql
 * CREATE TYPE name AS ENUM ( [ label [, ...] ] )
 * ```
 */
export class CreateEnum extends CreateEnumChange {
  public readonly enum: Enum;
  public readonly scope = "object" as const;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  get creates() {
    return [this.enum.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.enum.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.enum.owner));

    return Array.from(dependencies);
  }

  serialize(): string {
    const parts: string[] = ["CREATE TYPE"];

    // Add schema and name
    parts.push(`${this.enum.schema}.${this.enum.name}`);

    // Add AS ENUM
    parts.push("AS ENUM");

    // Add labels
    const labels = this.enum.labels.map((label) => quoteLiteral(label.label));
    parts.push(`(${labels.join(", ")})`);

    return parts.join(" ");
  }
}
