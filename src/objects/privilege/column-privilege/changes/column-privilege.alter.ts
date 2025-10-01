import { Change } from "../../../base.change.ts";

export class GrantColumnPrivileges extends Change {
  public readonly tableId: string;
  public readonly tableNameSql: string;
  public readonly grantee: string;
  public readonly items: {
    privilege: string;
    grantable: boolean;
    columns: string[];
  }[];
  public readonly operation = "create" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "table" as const;

  constructor(props: {
    tableId: string;
    tableNameSql: string;
    grantee: string;
    items: { privilege: string; grantable: boolean; columns: string[] }[];
  }) {
    super();
    this.tableId = props.tableId;
    this.tableNameSql = props.tableNameSql;
    this.grantee = props.grantee;
    this.items = props.items;
  }

  get dependencies() {
    const aclcolStableId = `aclcol:${this.tableId}::grantee:${this.grantee}`;
    return [aclcolStableId];
  }

  serialize(): string {
    const stmts: string[] = [];
    const groups = new Map<boolean, Map<string, string[]>>();
    for (const item of this.items) {
      if (!groups.has(item.grantable)) groups.set(item.grantable, new Map());
      const g = groups.get(item.grantable);
      if (!g) continue;
      if (!g.has(item.privilege)) g.set(item.privilege, []);
      const arr = g.get(item.privilege);
      if (arr) arr.push(...item.columns);
    }
    for (const [grantable, byPriv] of groups) {
      const withGrant = grantable ? " WITH GRANT OPTION" : "";
      for (const [priv, cols] of byPriv) {
        const uniqueCols = [...new Set(cols)].sort();
        stmts.push(
          `GRANT ${priv} (${uniqueCols.join(", ")}) ON TABLE ${this.tableNameSql} TO ${this.grantee}${withGrant}`,
        );
      }
    }
    return stmts.join("; ");
  }
}

export class RevokeColumnPrivileges extends Change {
  public readonly tableId: string;
  public readonly tableNameSql: string;
  public readonly grantee: string;
  public readonly items: {
    privilege: string;
    grantable: boolean;
    columns: string[];
  }[];
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "table" as const;

  constructor(props: {
    tableId: string;
    tableNameSql: string;
    grantee: string;
    items: { privilege: string; grantable: boolean; columns: string[] }[];
  }) {
    super();
    this.tableId = props.tableId;
    this.tableNameSql = props.tableNameSql;
    this.grantee = props.grantee;
    this.items = props.items;
  }

  get dependencies() {
    const aclcolStableId = `aclcol:${this.tableId}::grantee:${this.grantee}`;
    return [aclcolStableId];
  }

  serialize(): string {
    const stmts: string[] = [];
    const byPriv = new Map<string, string[]>();
    for (const item of this.items) {
      if (!byPriv.has(item.privilege)) byPriv.set(item.privilege, []);
      const arr = byPriv.get(item.privilege);
      if (arr) arr.push(...item.columns);
    }
    for (const [priv, cols] of byPriv) {
      const uniqueCols = [...new Set(cols)].sort();
      stmts.push(
        `REVOKE ${priv} (${uniqueCols.join(", ")}) ON TABLE ${this.tableNameSql} FROM ${this.grantee}`,
      );
    }
    return stmts.join("; ");
  }
}

export class RevokeGrantOptionColumnPrivileges extends Change {
  public readonly tableId: string;
  public readonly tableNameSql: string;
  public readonly grantee: string;
  public readonly items: { privilege: string; columns: string[] }[];
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "table" as const;

  constructor(props: {
    tableId: string;
    tableNameSql: string;
    grantee: string;
    items: { privilege: string; columns: string[] }[];
  }) {
    super();
    this.tableId = props.tableId;
    this.tableNameSql = props.tableNameSql;
    this.grantee = props.grantee;
    this.items = props.items;
  }

  get dependencies() {
    const aclcolStableId = `aclcol:${this.tableId}::grantee:${this.grantee}`;
    return [aclcolStableId];
  }

  serialize(): string {
    const stmts: string[] = [];
    for (const item of this.items) {
      const cols = [...new Set(item.columns)].sort();
      stmts.push(
        `REVOKE GRANT OPTION FOR ${item.privilege} (${cols.join(", ")}) ON TABLE ${this.tableNameSql} FROM ${this.grantee}`,
      );
    }
    return stmts.join("; ");
  }
}
