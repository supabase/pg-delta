import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../../base.privilege.ts";
import { stableId } from "../../../utils.ts";
import type { Range } from "../range.model.ts";
import { CreateRangeChange, DropRangeChange } from "./range.base.ts";

export type RangePrivilege =
  | GrantRangePrivileges
  | RevokeRangePrivileges
  | RevokeGrantOptionRangePrivileges;

/**
 * Grant privileges on a range type.
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
export class GrantRangePrivileges extends CreateRangeChange {
  public readonly range: Range;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    range: Range;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.range = props.range;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.range.stableId, this.grantee)];
  }

  get requires() {
    return [this.range.stableId, stableId.role(this.grantee)];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantRangePrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("TYPE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("TYPE", list, this.version);
    const typeName = `${this.range.schema}.${this.range.name}`;
    return `GRANT ${privSql} ${kindPrefix} ${typeName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a range type.
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
export class RevokeRangePrivileges extends DropRangeChange {
  public readonly range: Range;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    range: Range;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.range = props.range;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    return [stableId.acl(this.range.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.range.stableId, this.grantee),
      this.range.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("TYPE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("TYPE", list, this.version);
    const typeName = `${this.range.schema}.${this.range.name}`;
    return `REVOKE ${privSql} ${kindPrefix} ${typeName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a range type.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionRangePrivileges extends DropRangeChange {
  public readonly range: Range;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    range: Range;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.range = props.range;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.range.stableId, this.grantee),
      this.range.stableId,
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
    const typeName = `${this.range.schema}.${this.range.name}`;
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${typeName} FROM ${this.grantee}`;
  }
}
