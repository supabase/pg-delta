import { Change } from "../../../base.change.ts";

/**
 * Alter a default privilege.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html
 *
 * Synopsis
 * ```sql
 * ALTER DEFAULT PRIVILEGES
 *     [ FOR { ROLE | USER } target_role [, ...] ]
 *     [ IN SCHEMA schema_name [, ...] ]
 *     abbreviated_grant_or_revoke
 *
 * where abbreviated_grant_or_revoke is one of:
 *
 * GRANT { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON TABLES
 *     TO { [ GROUP ] role_name | PUBLIC } [, ...] [ WITH GRANT OPTION ]
 *
 * GRANT { { USAGE | SELECT | UPDATE }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON SEQUENCES
 *     TO { [ GROUP ] role_name | PUBLIC } [, ...] [ WITH GRANT OPTION ]
 *
 * GRANT { EXECUTE | ALL [ PRIVILEGES ] }
 *     ON { FUNCTIONS | ROUTINES }
 *     TO { [ GROUP ] role_name | PUBLIC } [, ...] [ WITH GRANT OPTION ]
 *
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *     ON TYPES
 *     TO { [ GROUP ] role_name | PUBLIC } [, ...] [ WITH GRANT OPTION ]
 *
 * GRANT { { USAGE | CREATE }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON SCHEMAS
 *     TO { [ GROUP ] role_name | PUBLIC } [, ...] [ WITH GRANT OPTION ]
 *
 * GRANT { { SELECT | UPDATE }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON LARGE OBJECTS
 *     TO { [ GROUP ] role_name | PUBLIC } [, ...] [ WITH GRANT OPTION ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON TABLES
 *     FROM { [ GROUP ] role_name | PUBLIC } [, ...]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { { USAGE | SELECT | UPDATE }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON SEQUENCES
 *     FROM { [ GROUP ] role_name | PUBLIC } [, ...]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { EXECUTE | ALL [ PRIVILEGES ] }
 *     ON { FUNCTIONS | ROUTINES }
 *     FROM { [ GROUP ] role_name | PUBLIC } [, ...]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON TYPES
 *     FROM { [ GROUP ] role_name | PUBLIC } [, ...]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { { USAGE | CREATE }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON SCHEMAS
 *     FROM { [ GROUP ] role_name | PUBLIC } [, ...]
 *     [ CASCADE | RESTRICT ]
 *
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SELECT | UPDATE }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON LARGE OBJECTS
 *     FROM { [ GROUP ] role_name | PUBLIC } [, ...]
 *     [ CASCADE | RESTRICT ]
 * ```
 *
 * Notes for diff-based generation:
 * - We currently only emit OWNER TO when owner differs.
 * - Name/schema changes are treated as identity changes; handled as drop/create by the diff engine.
 * - Column attribute changes, CLUSTER are not modeled and thus not emitted.
 * - Changes to definition, options, and other non-alterable properties trigger a replace (drop + create).
 */

function objtypeToKeyword(objtype: string): string {
  switch (objtype) {
    case "r":
      return "TABLES";
    case "S":
      return "SEQUENCES";
    case "f":
      return "ROUTINES";
    case "T":
      return "TYPES";
    case "n":
      return "SCHEMAS";
    default:
      return objtype;
  }
}

function defaultPrivilegeUniverse(objtype: string, version: number): string[] {
  // Full privilege sets per object kind for ALTER DEFAULT PRIVILEGES
  // Keep names aligned with pg_catalog privilege_type values
  switch (objtype) {
    case "r": {
      // TABLES
      // MAINTAIN exists on PostgreSQL >= 17
      const includesMaintain = version >= 170000;
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
    case "S": // SEQUENCES
      return ["SELECT", "UPDATE", "USAGE"].sort();
    case "f": // ROUTINES (FUNCTIONS)
      return ["EXECUTE"];
    case "T": // TYPES
      return ["USAGE"];
    case "n": // SCHEMAS
      return ["CREATE", "USAGE"].sort();
    default:
      return [];
  }
}

function isFullPrivilegeSet(
  objtype: string,
  list: string[],
  version: number,
): boolean {
  const uniqSorted = [...new Set(list)].sort();
  const fullSorted = [...defaultPrivilegeUniverse(objtype, version)].sort();
  if (uniqSorted.length !== fullSorted.length) return false;
  for (let i = 0; i < uniqSorted.length; i++) {
    if (uniqSorted[i] !== fullSorted[i]) return false;
  }
  return true;
}

function formatPrivilegeList(
  objtype: string,
  list: string[],
  version: number,
): string {
  const uniqSorted = [...new Set(list)].sort();
  return isFullPrivilegeSet(objtype, uniqSorted, version)
    ? "ALL"
    : uniqSorted.join(", ");
}

export class AlterDefaultPrivilegesGrant extends Change {
  public readonly grantor: string;
  public readonly inSchema: string | null;
  public readonly objtype: string;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number;
  public readonly operation = "create" as const;
  public readonly scope = "default_privilege" as const;
  public readonly objectType = "role" as const;

  constructor(props: {
    grantor: string;
    inSchema: string | null;
    objtype: string;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version: number;
  }) {
    super();
    this.grantor = props.grantor;
    this.inSchema = props.inSchema;
    this.objtype = props.objtype;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const scope = this.inSchema ? `schema:${this.inSchema}` : "global";
    const defaclStableId = `defacl:${this.grantor}:${this.objtype}:${scope}:grantee:${this.grantee}`;
    return [defaclStableId];
  }

  serialize(): string {
    const scope = this.inSchema ? ` IN SCHEMA ${this.inSchema}` : "";
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "AlterDefaultPrivilegesGrant expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const privSql = formatPrivilegeList(
      this.objtype,
      this.privileges.map((p) => p.privilege),
      this.version,
    );
    return `ALTER DEFAULT PRIVILEGES FOR ROLE ${this.grantor}${scope} GRANT ${privSql} ON ${objtypeToKeyword(this.objtype)} TO ${this.grantee}${withGrant}`;
  }
}

export class AlterDefaultPrivilegesRevoke extends Change {
  public readonly grantor: string;
  public readonly inSchema: string | null;
  public readonly objtype: string;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number;
  public readonly operation = "drop" as const;
  public readonly scope = "default_privilege" as const;
  public readonly objectType = "role" as const;

  constructor(props: {
    grantor: string;
    inSchema: string | null;
    objtype: string;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version: number;
  }) {
    super();
    this.grantor = props.grantor;
    this.inSchema = props.inSchema;
    this.objtype = props.objtype;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const scope = this.inSchema ? `schema:${this.inSchema}` : "global";
    const defaclStableId = `defacl:${this.grantor}:${this.objtype}:${scope}:grantee:${this.grantee}`;
    return [defaclStableId];
  }

  serialize(): string {
    const scope = this.inSchema ? ` IN SCHEMA ${this.inSchema}` : "";
    const grantOptionPrivs = this.privileges
      .filter((p) => p.grantable)
      .map((p) => p.privilege);
    const basePrivs = this.privileges
      .filter((p) => !p.grantable)
      .map((p) => p.privilege);
    const hasGrantOption = grantOptionPrivs.length > 0;
    const hasBase = basePrivs.length > 0;
    if (hasGrantOption && hasBase) {
      throw new Error(
        "AlterDefaultPrivilegesRevoke expects privileges from a single revoke kind",
      );
    }
    if (hasGrantOption) {
      const privSql = formatPrivilegeList(
        this.objtype,
        grantOptionPrivs,
        this.version,
      );
      return `ALTER DEFAULT PRIVILEGES FOR ROLE ${this.grantor}${scope} REVOKE GRANT OPTION FOR ${privSql} ON ${objtypeToKeyword(this.objtype)} FROM ${this.grantee}`;
    }
    const privSql = formatPrivilegeList(this.objtype, basePrivs, this.version);
    return `ALTER DEFAULT PRIVILEGES FOR ROLE ${this.grantor}${scope} REVOKE ${privSql} ON ${objtypeToKeyword(this.objtype)} FROM ${this.grantee}`;
  }
}
