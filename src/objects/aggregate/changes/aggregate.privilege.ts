import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import { stableId } from "../../utils.ts";
import type { Aggregate } from "../aggregate.model.ts";
import {
  CreateAggregateChange,
  DropAggregateChange,
} from "./aggregate.base.ts";

export type AggregatePrivilege =
  | GrantAggregatePrivileges
  | RevokeAggregatePrivileges
  | RevokeGrantOptionAggregatePrivileges;

export class GrantAggregatePrivileges extends CreateAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    aggregate: Aggregate;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.aggregate = props.aggregate;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.aggregate.stableId, this.grantee)];
  }

  get requires() {
    return [this.aggregate.stableId, stableId.role(this.grantee)];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantAggregatePrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("FUNCTION");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("FUNCTION", list, this.version);
    const aggregateName = `${this.aggregate.schema}.${this.aggregate.name}`;
    const signature = this.aggregate.identityArguments;
    const qualified = `${aggregateName}(${signature})`;
    return `GRANT ${privSql} ${kindPrefix} ${qualified} TO ${this.grantee}${withGrant}`;
  }
}

export class RevokeAggregatePrivileges extends DropAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    aggregate: Aggregate;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.aggregate = props.aggregate;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    return [stableId.acl(this.aggregate.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.aggregate.stableId, this.grantee),
      this.aggregate.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("FUNCTION");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("FUNCTION", list, this.version);
    const aggregateName = `${this.aggregate.schema}.${this.aggregate.name}`;
    const signature = this.aggregate.identityArguments;
    const qualified = `${aggregateName}(${signature})`;
    return `REVOKE ${privSql} ${kindPrefix} ${qualified} FROM ${this.grantee}`;
  }
}

export class RevokeGrantOptionAggregatePrivileges extends DropAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    aggregate: Aggregate;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.aggregate = props.aggregate;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.aggregate.stableId, this.grantee),
      this.aggregate.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("FUNCTION");
    const privSql = formatObjectPrivilegeList(
      "FUNCTION",
      this.privilegeNames,
      this.version,
    );
    const aggregateName = `${this.aggregate.schema}.${this.aggregate.name}`;
    const signature = this.aggregate.identityArguments;
    const qualified = `${aggregateName}(${signature})`;
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${qualified} FROM ${this.grantee}`;
  }
}
