import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import { stableId } from "../../utils.ts";
import type { View } from "../view.model.ts";
import { CreateViewChange, DropViewChange } from "./view.base.ts";

export type ViewPrivilege =
  | GrantViewPrivileges
  | RevokeViewPrivileges
  | RevokeGrantOptionViewPrivileges;

/**
 * Grant privileges on a view.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { [ TABLE ] view_name [, ...]
 *          | ALL TABLES IN SCHEMA schema_name [, ...] }
 *     TO role_specification [, ...] [ WITH GRANT OPTION ]
 *     [ GRANTED BY role_specification ]
 * ```
 */
export class GrantViewPrivileges extends CreateViewChange {
  public readonly view: View;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    view: View;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.view = props.view;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.columns = props.columns;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.view.stableId, this.grantee)];
  }

  get requires() {
    return [this.view.stableId, stableId.role(this.grantee)];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantViewPrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("VIEW");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("VIEW", list, this.version);
    const viewName = `${this.view.schema}.${this.view.name}`;
    const columnSpec =
      this.columns && this.columns.length > 0
        ? ` (${this.columns.join(", ")})`
        : "";
    return `GRANT ${privSql}${columnSpec} ${kindPrefix} ${viewName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a view.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { [ TABLE ] view_name [, ...]
 *          | ALL TABLES IN SCHEMA schema_name [, ...] }
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeViewPrivileges extends DropViewChange {
  public readonly view: View;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    view: View;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.view = props.view;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.columns = props.columns;
    this.version = props.version;
  }

  get drops() {
    return [stableId.acl(this.view.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.view.stableId, this.grantee),
      this.view.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("VIEW");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("VIEW", list, this.version);
    const viewName = `${this.view.schema}.${this.view.name}`;
    const columnSpec =
      this.columns && this.columns.length > 0
        ? ` (${this.columns.join(", ")})`
        : "";
    return `REVOKE ${privSql}${columnSpec} ${kindPrefix} ${viewName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a view.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionViewPrivileges extends DropViewChange {
  public readonly view: View;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    view: View;
    grantee: string;
    privilegeNames: string[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.view = props.view;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.columns = props.columns;
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.view.stableId, this.grantee),
      this.view.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("VIEW");
    const privSql = formatObjectPrivilegeList(
      "VIEW",
      this.privilegeNames,
      this.version,
    );
    const viewName = `${this.view.schema}.${this.view.name}`;
    const columnSpec =
      this.columns && this.columns.length > 0
        ? ` (${this.columns.join(", ")})`
        : "";
    return `REVOKE GRANT OPTION FOR ${privSql}${columnSpec} ${kindPrefix} ${viewName} FROM ${this.grantee}`;
  }
}
