import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import { stableId } from "../../utils.ts";
import type { Language } from "../language.model.ts";
import { CreateLanguageChange, DropLanguageChange } from "./language.base.ts";

export type LanguagePrivilege =
  | GrantLanguagePrivileges
  | RevokeLanguagePrivileges
  | RevokeGrantOptionLanguagePrivileges;

/**
 * Grant privileges on a language.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *    ON LANGUAGE language_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 * ```
 */
export class GrantLanguagePrivileges extends CreateLanguageChange {
  public readonly language: Language;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    language: Language;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.language = props.language;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.language.stableId, this.grantee)];
  }

  get requires() {
    return [this.language.stableId, stableId.role(this.grantee)];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantLanguagePrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("LANGUAGE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("LANGUAGE", list, this.version);
    return `GRANT ${privSql} ${kindPrefix} ${this.language.name} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a language.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON LANGUAGE language_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeLanguagePrivileges extends DropLanguageChange {
  public readonly language: Language;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    language: Language;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.language = props.language;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    return [stableId.acl(this.language.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.language.stableId, this.grantee),
      this.language.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("LANGUAGE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("LANGUAGE", list, this.version);
    return `REVOKE ${privSql} ${kindPrefix} ${this.language.name} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a language.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionLanguagePrivileges extends DropLanguageChange {
  public readonly language: Language;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    language: Language;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.language = props.language;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.language.stableId, this.grantee),
      this.language.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("LANGUAGE");
    const privSql = formatObjectPrivilegeList(
      "LANGUAGE",
      this.privilegeNames,
      this.version,
    );
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${this.language.name} FROM ${this.grantee}`;
  }
}
