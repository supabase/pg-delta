import { Change } from "../../base.change.ts";
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
export class DropRlsPolicy extends Change {
  public readonly rlsPolicy: RlsPolicy;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "rls_policy" as const;

  constructor(props: { rlsPolicy: RlsPolicy }) {
    super();
    this.rlsPolicy = props.rlsPolicy;
  }

  get dependencies() {
    return [this.rlsPolicy.stableId];
  }

  serialize(): string {
    return [
      "DROP POLICY",
      this.rlsPolicy.name,
      "ON",
      `${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}`,
    ].join(" ");
  }
}
