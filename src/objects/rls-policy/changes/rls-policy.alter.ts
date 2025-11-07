import type { RlsPolicy } from "../rls-policy.model.ts";
import { AlterRlsPolicyChange } from "./rls-policy.base.ts";

/**
 * Alter an RLS policy.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterpolicy.html
 *
 * Synopsis
 * ```sql
 * ALTER POLICY name ON table_name
 *     [ TO { role_name | PUBLIC | CURRENT_ROLE | CURRENT_USER | SESSION_USER } [, ...] ]
 *     [ USING ( using_expression ) ]
 *     [ WITH CHECK ( with_check_expression ) ]
 * ```
 */

export type AlterRlsPolicy =
  | AlterRlsPolicySetRoles
  | AlterRlsPolicySetUsingExpression
  | AlterRlsPolicySetWithCheckExpression;

/**
 * ALTER POLICY ... TO roles ...
 */
export class AlterRlsPolicySetRoles extends AlterRlsPolicyChange {
  public readonly policy: RlsPolicy;
  public readonly roles: string[];
  public readonly scope = "object" as const;

  constructor(props: { policy: RlsPolicy; roles: string[] }) {
    super();
    this.policy = props.policy;
    this.roles = props.roles;
  }

  get requires() {
    return [this.policy.stableId];
  }

  serialize(): string {
    const targetRoles = this.roles;
    const toPublic =
      targetRoles.length === 0 ||
      (targetRoles.length === 1 && targetRoles[0].toLowerCase() === "public");
    const rolesSql = toPublic ? "PUBLIC" : targetRoles.join(", ");

    return [
      "ALTER POLICY",
      `${this.policy.schema}.${this.policy.name}`,
      "ON",
      `${this.policy.schema}.${this.policy.table_name}`,
      "TO",
      rolesSql,
    ].join(" ");
  }
}

/**
 * ALTER POLICY ... USING (...)
 */
export class AlterRlsPolicySetUsingExpression extends AlterRlsPolicyChange {
  public readonly policy: RlsPolicy;
  public readonly usingExpression: string | null;
  public readonly scope = "object" as const;

  constructor(props: { policy: RlsPolicy; usingExpression: string | null }) {
    super();
    this.policy = props.policy;
    this.usingExpression = props.usingExpression;
  }

  get requires() {
    return [this.policy.stableId];
  }

  serialize(): string {
    const expr = this.usingExpression ?? "true";
    return [
      "ALTER POLICY",
      `${this.policy.schema}.${this.policy.name}`,
      "ON",
      `${this.policy.schema}.${this.policy.table_name}`,
      "USING",
      `(${expr})`,
    ].join(" ");
  }
}

/**
 * ALTER POLICY ... WITH CHECK (...)
 */
export class AlterRlsPolicySetWithCheckExpression extends AlterRlsPolicyChange {
  public readonly policy: RlsPolicy;
  public readonly withCheckExpression: string | null;
  public readonly scope = "object" as const;

  constructor(props: {
    policy: RlsPolicy;
    withCheckExpression: string | null;
  }) {
    super();
    this.policy = props.policy;
    this.withCheckExpression = props.withCheckExpression;
  }

  get requires() {
    return [this.policy.stableId];
  }

  serialize(): string {
    const expr = this.withCheckExpression ?? "true";
    return [
      "ALTER POLICY",
      `${this.policy.schema}.${this.policy.name}`,
      "ON",
      `${this.policy.schema}.${this.policy.table_name}`,
      "WITH CHECK",
      `(${expr})`,
    ].join(" ");
  }
}

/**
 * Replace an RLS policy by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER POLICY change.
 */
// NOTE: ReplaceRlsPolicy removed. Non-alterable changes are emitted as Drop + Create in rls-policy.diff.ts.
