import { Change, type ChangeObjectType } from "../../../base.change.ts";

/**
 * Define an object access privileges.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 *
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *    ON FOREIGN DATA WRAPPER fdw_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 *
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *    ON FOREIGN SERVER server_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 *
 * GRANT { EXECUTE | ALL [ PRIVILEGES ] }
 *    ON { { FUNCTION | PROCEDURE | ROUTINE } routine_name [ ( [ [ argmode ] [ arg_name ] arg_type [, ...] ] ) ] [, ...]
 *         | ALL { FUNCTIONS | PROCEDURES | ROUTINES } IN SCHEMA schema_name [, ...] }
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 *
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *    ON LANGUAGE lang_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 *
 * GRANT { { SELECT | UPDATE } [, ...] | ALL [ PRIVILEGES ] }
 *    ON LARGE OBJECT loid [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 *
 * GRANT { { SET | ALTER SYSTEM } [, ... ] | ALL [ PRIVILEGES ] }
 *    ON PARAMETER configuration_parameter [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 *
 * GRANT { { CREATE | USAGE } [, ...] | ALL [ PRIVILEGES ] }
 *    ON SCHEMA schema_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 *
 * GRANT { CREATE | ALL [ PRIVILEGES ] }
 *    ON TABLESPACE tablespace_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 *
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *    ON TYPE type_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 *
 * GRANT role_name [, ...] TO role_specification [, ...]
 *    [ WITH { ADMIN | INHERIT | SET } { OPTION | TRUE | FALSE } ]
 *    [ GRANTED BY role_specification ]
 *
 * where role_specification can be:
 *
 *    [ GROUP ] role_name
 *  | PUBLIC
 *  | CURRENT_ROLE
 *  | CURRENT_USER
 *  | SESSION_USER
 * ```
 */

export class GrantObjectPrivileges extends Change {
  public readonly objectId: string;
  public readonly objectNameSql: string;
  public readonly objectKind: string;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly operation = "create" as const;
  public readonly scope = "privilege" as const;
  public get objectType(): ChangeObjectType {
    switch (this.objectKind) {
      case "ROUTINE":
        return "procedure";
      case "LANGUAGE":
        return "language";
      case "SCHEMA":
        return "schema";
      case "SEQUENCE":
        return "sequence";
      case "DOMAIN":
        return "domain";
      case "TYPE":
        return "composite_type";
      case "TABLE":
        return "table";
      case "VIEW":
        return "view";
      case "MATERIALIZED VIEW":
        return "materialized_view";
      default:
        throw new Error(`Unknown object kind: ${this.objectKind}`);
    }
  }

  constructor(props: {
    objectId: string;
    objectNameSql: string;
    objectKind: string;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.objectId = props.objectId;
    this.objectNameSql = props.objectNameSql;
    this.objectKind = props.objectKind;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.objectId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantObjectPrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix =
      this.objectKind === "ROUTINE"
        ? "ON ROUTINE"
        : this.objectKind === "LANGUAGE"
          ? "ON LANGUAGE"
          : this.objectKind === "SCHEMA"
            ? "ON SCHEMA"
            : this.objectKind === "SEQUENCE"
              ? "ON SEQUENCE"
              : this.objectKind === "DOMAIN"
                ? "ON DOMAIN"
                : this.objectKind === "TYPE"
                  ? "ON TYPE"
                  : "ON";
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList(
      this.objectKind,
      list,
      this.version,
    );
    return `GRANT ${privSql} ${kindPrefix} ${this.objectNameSql} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke an object access privileges.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { [ TABLE ] table_name [, ...]
 *          | ALL TABLES IN SCHEMA schema_name [, ...] }
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SELECT | INSERT | UPDATE | REFERENCES } ( column_name [, ...] )
 *     [, ...] | ALL [ PRIVILEGES ] ( column_name [, ...] ) }
 *     ON [ TABLE ] table_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { { USAGE | SELECT | UPDATE }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { SEQUENCE sequence_name [, ...]
 *          | ALL SEQUENCES IN SCHEMA schema_name [, ...] }
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { { CREATE | CONNECT | TEMPORARY | TEMP } [, ...] | ALL [ PRIVILEGES ] }
 *     ON DATABASE database_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON DOMAIN domain_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON FOREIGN DATA WRAPPER fdw_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON FOREIGN SERVER server_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { EXECUTE | ALL [ PRIVILEGES ] }
 *     ON { { FUNCTION | PROCEDURE | ROUTINE } function_name [ ( [ [ argmode ] [ arg_name ] arg_type [, ...] ] ) ] [, ...]
 *          | ALL { FUNCTIONS | PROCEDURES | ROUTINES } IN SCHEMA schema_name [, ...] }
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON LANGUAGE lang_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SELECT | UPDATE } [, ...] | ALL [ PRIVILEGES ] }
 *     ON LARGE OBJECT loid [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SET | ALTER SYSTEM } [, ...] | ALL [ PRIVILEGES ] }
 *     ON PARAMETER configuration_parameter [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { { CREATE | USAGE } [, ...] | ALL [ PRIVILEGES ] }
 *     ON SCHEMA schema_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { CREATE | ALL [ PRIVILEGES ] }
 *     ON TABLESPACE tablespace_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON TYPE type_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ { ADMIN | INHERIT | SET } OPTION FOR ]
 *     role_name [, ...] FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 *
 * where role_specification can be:
 *
 *     [ GROUP ] role_name
 *   | PUBLIC
 *   | CURRENT_ROLE
 *   | CURRENT_USER
 *   | SESSION_USER
 * ```
 */

export class RevokeObjectPrivileges extends Change {
  public readonly objectId: string;
  public readonly objectNameSql: string;
  public readonly objectKind: string;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public get objectType(): ChangeObjectType {
    switch (this.objectKind) {
      case "ROUTINE":
        return "procedure";
      case "LANGUAGE":
        return "language";
      case "SCHEMA":
        return "schema";
      case "SEQUENCE":
        return "sequence";
      case "DOMAIN":
        return "domain";
      case "TYPE":
        return "composite_type";
      case "TABLE":
        return "table";
      case "VIEW":
        return "view";
      case "MATERIALIZED VIEW":
        return "materialized_view";
      default:
        throw new Error(`Unknown object kind: ${this.objectKind}`);
    }
  }

  constructor(props: {
    objectId: string;
    objectNameSql: string;
    objectKind: string;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.objectId = props.objectId;
    this.objectNameSql = props.objectNameSql;
    this.objectKind = props.objectKind;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.objectId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix =
      this.objectKind === "ROUTINE"
        ? "ON ROUTINE"
        : this.objectKind === "LANGUAGE"
          ? "ON LANGUAGE"
          : this.objectKind === "SCHEMA"
            ? "ON SCHEMA"
            : this.objectKind === "SEQUENCE"
              ? "ON SEQUENCE"
              : this.objectKind === "DOMAIN"
                ? "ON DOMAIN"
                : this.objectKind === "TYPE"
                  ? "ON TYPE"
                  : "ON";
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList(
      this.objectKind,
      list,
      this.version,
    );
    return `REVOKE ${privSql} ${kindPrefix} ${this.objectNameSql} FROM ${this.grantee}`;
  }
}

export class RevokeGrantOptionObjectPrivileges extends Change {
  public readonly objectId: string;
  public readonly objectNameSql: string;
  public readonly objectKind: string;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public get objectType(): ChangeObjectType {
    switch (this.objectKind) {
      case "ROUTINE":
        return "procedure";
      case "LANGUAGE":
        return "language";
      case "SCHEMA":
        return "schema";
      case "SEQUENCE":
        return "sequence";
      case "DOMAIN":
        return "domain";
      case "TYPE":
        return "composite_type";
      case "TABLE":
        return "table";
      case "VIEW":
        return "view";
      case "MATERIALIZED VIEW":
        return "materialized_view";
      default:
        throw new Error(`Unknown object kind: ${this.objectKind}`);
    }
  }

  constructor(props: {
    objectId: string;
    objectNameSql: string;
    objectKind: string;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.objectId = props.objectId;
    this.objectNameSql = props.objectNameSql;
    this.objectKind = props.objectKind;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.objectId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix =
      this.objectKind === "ROUTINE"
        ? "ON ROUTINE"
        : this.objectKind === "LANGUAGE"
          ? "ON LANGUAGE"
          : this.objectKind === "SCHEMA"
            ? "ON SCHEMA"
            : this.objectKind === "SEQUENCE"
              ? "ON SEQUENCE"
              : this.objectKind === "DOMAIN"
                ? "ON DOMAIN"
                : this.objectKind === "TYPE"
                  ? "ON TYPE"
                  : "ON";
    const privSql = formatObjectPrivilegeList(
      this.objectKind,
      this.privilegeNames,
      this.version,
    );
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${this.objectNameSql} FROM ${this.grantee}`;
  }
}

function objectPrivilegeUniverse(
  kind: string,
  version: number | undefined,
): string[] {
  switch (kind) {
    case "TABLE": {
      const includesMaintain = (version ?? 170000) >= 170000;
      return [
        "DELETE",
        "INSERT",
        ...(includesMaintain ? (["MAINTAIN"] as const) : []),
        "REFERENCES",
        "SELECT",
        "TRIGGER",
        "TRUNCATE",
        "UPDATE",
      ];
    }
    case "VIEW": {
      // Per PostgreSQL docs, views are table-like and share the table privilege set
      // for GRANT/REVOKE purposes. Do not include MAINTAIN for views.
      return [
        "DELETE",
        "INSERT",
        "REFERENCES",
        "SELECT",
        "TRIGGER",
        "TRUNCATE",
        "UPDATE",
      ].sort();
    }
    case "MATERIALIZED VIEW": {
      const includesMaintain = (version ?? 170000) >= 170000;
      return [
        "SELECT",
        ...(includesMaintain ? (["MAINTAIN"] as const) : []),
      ].sort();
    }
    case "SEQUENCE":
      return ["SELECT", "UPDATE", "USAGE"].sort();
    case "SCHEMA":
      return ["CREATE", "USAGE"].sort();
    case "LANGUAGE":
      return ["USAGE"];
    case "TYPE":
    case "DOMAIN":
      return ["USAGE"];
    case "ROUTINE":
      return ["EXECUTE"];
    default:
      return [];
  }
}

function isFullObjectPrivilegeSet(
  kind: string,
  list: string[],
  version: number | undefined,
): boolean {
  const uniqSorted = [...new Set(list)].sort();
  const fullSorted = [...objectPrivilegeUniverse(kind, version)].sort();
  if (uniqSorted.length !== fullSorted.length) return false;
  for (let i = 0; i < uniqSorted.length; i++) {
    if (uniqSorted[i] !== fullSorted[i]) return false;
  }
  return true;
}

function formatObjectPrivilegeList(
  kind: string,
  list: string[],
  version: number | undefined,
): string {
  const uniqSorted = [...new Set(list)].sort();
  return isFullObjectPrivilegeSet(kind, uniqSorted, version)
    ? "ALL"
    : uniqSorted.join(", ");
}
