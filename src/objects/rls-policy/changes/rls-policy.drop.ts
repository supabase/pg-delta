import { DropChange } from "../../base.change.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";

/**
 * Drop an RLS policy.
 *
 * @see https://www.postgresql.org/docs/17/sql-droppolicy.html
 *
 * Synopsis
 * ```sql
 * DROP POLICY [ IF EXISTS ] name ON table_name [ CASCADE | RESTRICT ]
 * ```
 */
export class DropRlsPolicy extends DropChange {
  public readonly rlsPolicy: RlsPolicy;

  constructor(props: { rlsPolicy: RlsPolicy }) {
    super();
    this.rlsPolicy = props.rlsPolicy;
  }

  get stableId(): string {
    return `${this.rlsPolicy.stableId}`;
  }

  serialize(): string {
    return [
      "DROP POLICY",
      `${this.rlsPolicy.schema}.${this.rlsPolicy.name}`,
      "ON",
      `${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}`,
    ].join(" ");
  }
}
