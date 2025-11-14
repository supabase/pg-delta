import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../../base.privilege.ts";
import { stableId } from "../../../utils.ts";
import type { Enum } from "../enum.model.ts";
import { AlterEnumChange } from "./enum.base.ts";

export type EnumPrivilege =
  | GrantEnumPrivileges
  | RevokeEnumPrivileges
  | RevokeGrantOptionEnumPrivileges;

/**
 * Grant privileges on an enum type.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *    ON TYPE type_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 * ```
 */
export class GrantEnumPrivileges extends AlterEnumChange {
  public readonly enum: Enum;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    enum: Enum;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.enum = props.enum;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.enum.stableId, this.grantee)];
  }

  get requires() {
    return [this.enum.stableId, stableId.role(this.grantee)];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantEnumPrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("TYPE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("TYPE", list, this.version);
    const typeName = `${this.enum.schema}.${this.enum.name}`;
    return `GRANT ${privSql} ${kindPrefix} ${typeName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on an enum type.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON TYPE type_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeEnumPrivileges extends AlterEnumChange {
  public readonly enum: Enum;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    enum: Enum;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.enum = props.enum;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    // Return ACL ID for dependency tracking, even though this is an ALTER operation
    // Phase assignment now uses operation type, so this won't affect phase placement
    return [stableId.acl(this.enum.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.enum.stableId, this.grantee),
      this.enum.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("TYPE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("TYPE", list, this.version);
    const typeName = `${this.enum.schema}.${this.enum.name}`;
    return `REVOKE ${privSql} ${kindPrefix} ${typeName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on an enum type.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionEnumPrivileges extends AlterEnumChange {
  public readonly enum: Enum;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    enum: Enum;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.enum = props.enum;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.enum.stableId, this.grantee),
      this.enum.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("TYPE");
    const privSql = formatObjectPrivilegeList(
      "TYPE",
      this.privilegeNames,
      this.version,
    );
    const typeName = `${this.enum.schema}.${this.enum.name}`;
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${typeName} FROM ${this.grantee}`;
  }
}
