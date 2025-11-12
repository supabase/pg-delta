import type { RlsPolicy } from "../rls-policy.model.ts";
import { DropRlsPolicyChange } from "./rls-policy.base.ts";

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
export class DropRlsPolicy extends DropRlsPolicyChange {
  public readonly policy: RlsPolicy;
  public readonly scope = "object" as const;

  constructor(props: { policy: RlsPolicy }) {
    super();
    this.policy = props.policy;
  }

  get drops() {
    return [this.policy.stableId];
  }

  get requires() {
    return [this.policy.stableId];
  }

  serialize(): string {
    return [
      "DROP POLICY",
      this.policy.name,
      "ON",
      `${this.policy.schema}.${this.policy.table_name}`,
    ].join(" ");
  }
}
