import { Change } from "../../base.change.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";

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

/**
 * ALTER POLICY ... TO roles ...
 */
export class AlterRlsPolicySetRoles extends Change {
  public readonly main: RlsPolicy;
  public readonly branch: RlsPolicy;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "rls_policy" as const;

  constructor(props: { main: RlsPolicy; branch: RlsPolicy }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    const targetRoles = this.branch.roles;
    const toPublic =
      targetRoles.length === 0 ||
      (targetRoles.length === 1 && targetRoles[0].toLowerCase() === "public");
    const rolesSql = toPublic ? "PUBLIC" : targetRoles.join(", ");

    return [
      "ALTER POLICY",
      `${this.main.schema}.${this.main.name}`,
      "ON",
      `${this.main.schema}.${this.main.table_name}`,
      "TO",
      rolesSql,
    ].join(" ");
  }
}

/**
 * ALTER POLICY ... USING (...)
 */
export class AlterRlsPolicySetUsingExpression extends Change {
  public readonly main: RlsPolicy;
  public readonly branch: RlsPolicy;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "rls_policy" as const;

  constructor(props: { main: RlsPolicy; branch: RlsPolicy }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    const expr = this.branch.using_expression ?? "true";
    return [
      "ALTER POLICY",
      `${this.main.schema}.${this.main.name}`,
      "ON",
      `${this.main.schema}.${this.main.table_name}`,
      "USING",
      `(${expr})`,
    ].join(" ");
  }
}

/**
 * ALTER POLICY ... WITH CHECK (...)
 */
export class AlterRlsPolicySetWithCheckExpression extends Change {
  public readonly main: RlsPolicy;
  public readonly branch: RlsPolicy;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "rls_policy" as const;

  constructor(props: { main: RlsPolicy; branch: RlsPolicy }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    const expr = this.branch.with_check_expression ?? "true";
    return [
      "ALTER POLICY",
      `${this.main.schema}.${this.main.name}`,
      "ON",
      `${this.main.schema}.${this.main.table_name}`,
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
