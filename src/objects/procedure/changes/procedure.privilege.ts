import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import { stableId } from "../../utils.ts";
import type { Procedure } from "../procedure.model.ts";
import { AlterProcedureChange } from "./procedure.base.ts";

export type ProcedurePrivilege =
  | GrantProcedurePrivileges
  | RevokeProcedurePrivileges
  | RevokeGrantOptionProcedurePrivileges;

/**
 * Grant privileges on a procedure.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { EXECUTE | ALL [ PRIVILEGES ] }
 *    ON { { FUNCTION | PROCEDURE | ROUTINE } routine_name [ ( [ [ argmode ] [ arg_name ] arg_type [, ...] ] ) ] [, ...]
 *         | ALL { FUNCTIONS | PROCEDURES | ROUTINES } IN SCHEMA schema_name [, ...] }
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 * ```
 */
export class GrantProcedurePrivileges extends AlterProcedureChange {
  public readonly procedure: Procedure;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    procedure: Procedure;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.procedure = props.procedure;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.procedure.stableId, this.grantee)];
  }

  get requires() {
    return [this.procedure.stableId, stableId.role(this.grantee)];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantProcedurePrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const objectKind = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const kindPrefix = getObjectKindPrefix(objectKind);
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList(objectKind, list, this.version);
    const procedureName = `${this.procedure.schema}.${this.procedure.name}`;
    const args = this.procedure.argument_types?.join(", ") ?? "";
    // Always include parentheses for privilege statements, even for zero-argument procedures/functions
    const signature = `${procedureName}(${args})`;
    return `GRANT ${privSql} ${kindPrefix} ${signature} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a procedure.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { { EXECUTE | ALL [ PRIVILEGES ] } }
 *     ON { FUNCTION | PROCEDURE | ROUTINE } routine_name [ ( [ [ argmode ] [ argname ] argtype [, ...] ] ) ] [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeProcedurePrivileges extends AlterProcedureChange {
  public readonly procedure: Procedure;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    procedure: Procedure;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.procedure = props.procedure;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    // Return ACL ID for dependency tracking, even though this is an ALTER operation
    // Phase assignment now uses operation type, so this won't affect phase placement
    return [stableId.acl(this.procedure.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.procedure.stableId, this.grantee),
      this.procedure.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const objectKind = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const kindPrefix = getObjectKindPrefix(objectKind);
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList(objectKind, list, this.version);
    const procedureName = `${this.procedure.schema}.${this.procedure.name}`;
    const args = this.procedure.argument_types?.join(", ") ?? "";
    // Always include parentheses for privilege statements, even for zero-argument procedures/functions
    const signature = `${procedureName}(${args})`;
    return `REVOKE ${privSql} ${kindPrefix} ${signature} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a procedure.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionProcedurePrivileges extends AlterProcedureChange {
  public readonly procedure: Procedure;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    procedure: Procedure;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.procedure = props.procedure;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.procedure.stableId, this.grantee),
      this.procedure.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const objectKind = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const kindPrefix = getObjectKindPrefix(objectKind);
    const privSql = formatObjectPrivilegeList(
      objectKind,
      this.privilegeNames,
      this.version,
    );
    const procedureName = `${this.procedure.schema}.${this.procedure.name}`;
    const args = this.procedure.argument_types?.join(", ") ?? "";
    // Always include parentheses for privilege statements, even for zero-argument procedures/functions
    const signature = `${procedureName}(${args})`;
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${signature} FROM ${this.grantee}`;
  }
}
