import { AlterChange, ReplaceChange } from "../../base.change.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";
import { CreateRlsPolicy } from "./rls-policy.create.ts";
import { DropRlsPolicy } from "./rls-policy.drop.ts";

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
export class AlterRlsPolicySetRoles extends AlterChange {
  public readonly main: RlsPolicy;
  public readonly branch: RlsPolicy;

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
export class AlterRlsPolicySetUsingExpression extends AlterChange {
  public readonly main: RlsPolicy;
  public readonly branch: RlsPolicy;

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
export class AlterRlsPolicySetWithCheckExpression extends AlterChange {
  public readonly main: RlsPolicy;
  public readonly branch: RlsPolicy;

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
export class ReplaceRlsPolicy extends ReplaceChange {
  public readonly main: RlsPolicy;
  public readonly branch: RlsPolicy;

  constructor(props: { main: RlsPolicy; branch: RlsPolicy }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    const dropChange = new DropRlsPolicy({ rlsPolicy: this.main });
    const createChange = new CreateRlsPolicy({ rlsPolicy: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
