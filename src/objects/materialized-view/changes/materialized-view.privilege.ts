import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import { stableId } from "../../utils.ts";
import type { MaterializedView } from "../materialized-view.model.ts";
import {
  CreateMaterializedViewChange,
  DropMaterializedViewChange,
} from "./materialized-view.base.ts";

export type MaterializedViewPrivilege =
  | GrantMaterializedViewPrivileges
  | RevokeMaterializedViewPrivileges
  | RevokeGrantOptionMaterializedViewPrivileges;

/**
 * Grant privileges on a materialized view.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { [ TABLE ] table_name [, ...] }
 *     TO role_specification [, ...] [ WITH GRANT OPTION ]
 *     [ GRANTED BY role_specification ]
 * ```
 */
export class GrantMaterializedViewPrivileges extends CreateMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    materializedView: MaterializedView;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.materializedView = props.materializedView;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.columns = props.columns
      ? [...new Set(props.columns)].sort()
      : undefined;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.materializedView.stableId, this.grantee)];
  }

  get requires() {
    return [this.materializedView.stableId, stableId.role(this.grantee)];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantMaterializedViewPrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("MATERIALIZED VIEW");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList(
      "MATERIALIZED VIEW",
      list,
      this.version,
    );
    const materializedViewName = `${this.materializedView.schema}.${this.materializedView.name}`;

    // Add column list if present
    const columnClause = this.columns ? ` (${this.columns.join(", ")})` : "";

    return `GRANT ${privSql}${columnClause} ${kindPrefix} ${materializedViewName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a materialized view.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { [ TABLE ] table_name [, ...] }
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeMaterializedViewPrivileges extends DropMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    materializedView: MaterializedView;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.materializedView = props.materializedView;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.columns = props.columns
      ? [...new Set(props.columns)].sort()
      : undefined;
    this.version = props.version;
  }

  get drops() {
    return [stableId.acl(this.materializedView.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.materializedView.stableId, this.grantee),
      this.materializedView.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("MATERIALIZED VIEW");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList(
      "MATERIALIZED VIEW",
      list,
      this.version,
    );
    const materializedViewName = `${this.materializedView.schema}.${this.materializedView.name}`;

    // Add column list if present
    const columnClause = this.columns ? ` (${this.columns.join(", ")})` : "";

    return `REVOKE ${privSql}${columnClause} ${kindPrefix} ${materializedViewName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a materialized view.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionMaterializedViewPrivileges extends DropMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    materializedView: MaterializedView;
    grantee: string;
    privilegeNames: string[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.materializedView = props.materializedView;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.columns = props.columns
      ? [...new Set(props.columns)].sort()
      : undefined;
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.materializedView.stableId, this.grantee),
      this.materializedView.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("MATERIALIZED VIEW");
    const privSql = formatObjectPrivilegeList(
      "MATERIALIZED VIEW",
      this.privilegeNames,
      this.version,
    );
    const materializedViewName = `${this.materializedView.schema}.${this.materializedView.name}`;

    // Add column list if present
    const columnClause = this.columns ? ` (${this.columns.join(", ")})` : "";

    return `REVOKE GRANT OPTION FOR ${privSql}${columnClause} ${kindPrefix} ${materializedViewName} FROM ${this.grantee}`;
  }
}
