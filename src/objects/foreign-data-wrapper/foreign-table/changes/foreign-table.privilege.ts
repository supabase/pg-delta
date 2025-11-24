import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../../base.privilege.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignTable } from "../foreign-table.model.ts";
import { AlterForeignTableChange } from "./foreign-table.base.ts";

export type ForeignTablePrivilege =
  | GrantForeignTablePrivileges
  | RevokeForeignTablePrivileges
  | RevokeGrantOptionForeignTablePrivileges;

/**
 * Grant privileges on a foreign table.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER } [, ...] | ALL [ PRIVILEGES ] }
 *     ON FOREIGN TABLE table_name [, ...]
 *     TO role_specification [, ...] [ WITH GRANT OPTION ]
 *     [ GRANTED BY role_specification ]
 * ```
 */
export class GrantForeignTablePrivileges extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    foreignTable: ForeignTable;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.foreignTable = props.foreignTable;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.foreignTable.stableId, this.grantee)];
  }

  get requires() {
    return [this.foreignTable.stableId, stableId.role(this.grantee)];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantForeignTablePrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("FOREIGN TABLE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList(
      "FOREIGN TABLE",
      list,
      this.version,
    );
    const tableName = `${this.foreignTable.schema}.${this.foreignTable.name}`;
    return `GRANT ${privSql} ${kindPrefix} ${tableName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a foreign table.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER } [, ...] | ALL [ PRIVILEGES ] }
 *     ON FOREIGN TABLE table_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeForeignTablePrivileges extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    foreignTable: ForeignTable;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.foreignTable = props.foreignTable;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    return [stableId.acl(this.foreignTable.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.foreignTable.stableId, this.grantee),
      this.foreignTable.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("FOREIGN TABLE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList(
      "FOREIGN TABLE",
      list,
      this.version,
    );
    const tableName = `${this.foreignTable.schema}.${this.foreignTable.name}`;
    return `REVOKE ${privSql} ${kindPrefix} ${tableName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a foreign table.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionForeignTablePrivileges extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    foreignTable: ForeignTable;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.foreignTable = props.foreignTable;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.foreignTable.stableId, this.grantee),
      this.foreignTable.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("FOREIGN TABLE");
    const privSql = formatObjectPrivilegeList(
      "FOREIGN TABLE",
      this.privilegeNames,
      this.version,
    );
    const tableName = `${this.foreignTable.schema}.${this.foreignTable.name}`;
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${tableName} FROM ${this.grantee}`;
  }
}
