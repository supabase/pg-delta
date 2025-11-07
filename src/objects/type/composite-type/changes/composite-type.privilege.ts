import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../../base.privilege.ts";
import { stableId } from "../../../utils.ts";
import type { CompositeType } from "../composite-type.model.ts";
import {
  CreateCompositeTypeChange,
  DropCompositeTypeChange,
} from "./composite-type.base.ts";

export type CompositeTypePrivilege =
  | GrantCompositeTypePrivileges
  | RevokeCompositeTypePrivileges
  | RevokeGrantOptionCompositeTypePrivileges;

/**
 * Grant privileges on a composite type.
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
export class GrantCompositeTypePrivileges extends CreateCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    compositeType: CompositeType;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.compositeType = props.compositeType;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.compositeType.stableId, this.grantee)];
  }

  get requires() {
    return [this.compositeType.stableId, stableId.role(this.grantee)];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantCompositeTypePrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("TYPE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("TYPE", list, this.version);
    const typeName = `${this.compositeType.schema}.${this.compositeType.name}`;
    return `GRANT ${privSql} ${kindPrefix} ${typeName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a composite type.
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
export class RevokeCompositeTypePrivileges extends DropCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    compositeType: CompositeType;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.compositeType = props.compositeType;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    return [stableId.acl(this.compositeType.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.compositeType.stableId, this.grantee),
      this.compositeType.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("TYPE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("TYPE", list, this.version);
    const typeName = `${this.compositeType.schema}.${this.compositeType.name}`;
    return `REVOKE ${privSql} ${kindPrefix} ${typeName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a composite type.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionCompositeTypePrivileges extends DropCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    compositeType: CompositeType;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.compositeType = props.compositeType;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.compositeType.stableId, this.grantee),
      this.compositeType.stableId,
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
    const typeName = `${this.compositeType.schema}.${this.compositeType.name}`;
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${typeName} FROM ${this.grantee}`;
  }
}
