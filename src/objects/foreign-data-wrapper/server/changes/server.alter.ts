import type { SensitiveInfo } from "../../../../sensitive.types.ts";
import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { Server } from "../server.model.ts";
import { AlterServerChange } from "./server.base.ts";

/**
 * Alter a server.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterserver.html
 *
 * Synopsis
 * ```sql
 * ALTER SERVER name [ VERSION 'new_version' ]
 *     [ OPTIONS ( [ ADD | SET | DROP ] option ['value'] [, ... ] ) ]
 * ALTER SERVER name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ```
 */

export type AlterServer =
  | AlterServerChangeOwner
  | AlterServerSetOptions
  | AlterServerSetVersion;

/**
 * ALTER SERVER ... OWNER TO ...
 */
export class AlterServerChangeOwner extends AlterServerChange {
  public readonly server: Server;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { server: Server; owner: string }) {
    super();
    this.server = props.server;
    this.owner = props.owner;
  }

  get requires() {
    return [this.server.stableId, stableId.role(this.owner)];
  }

  serialize(): string {
    return ["ALTER SERVER", this.server.name, "OWNER TO", this.owner].join(" ");
  }
}

/**
 * ALTER SERVER ... VERSION ...
 */
export class AlterServerSetVersion extends AlterServerChange {
  public readonly server: Server;
  public readonly version: string | null;
  public readonly scope = "object" as const;

  constructor(props: { server: Server; version: string | null }) {
    super();
    this.server = props.server;
    this.version = props.version;
  }

  get requires() {
    return [this.server.stableId];
  }

  serialize(): string {
    if (this.version === null) {
      // PostgreSQL doesn't support removing version, but we'll handle it
      return ["ALTER SERVER", this.server.name, "VERSION", "''"].join(" ");
    }
    return [
      "ALTER SERVER",
      this.server.name,
      "VERSION",
      quoteLiteral(this.version),
    ].join(" ");
  }
}

/**
 * ALTER SERVER ... OPTIONS ( ADD | SET | DROP ... )
 */
export class AlterServerSetOptions extends AlterServerChange {
  public readonly server: Server;
  public readonly options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>;
  public readonly scope = "object" as const;

  constructor(props: {
    server: Server;
    options: Array<{
      action: "ADD" | "SET" | "DROP";
      option: string;
      value?: string;
    }>;
  }) {
    super();
    this.server = props.server;
    this.options = props.options;
  }

  get requires() {
    return [this.server.stableId];
  }

  get sensitiveInfo(): SensitiveInfo[] {
    const sensitive: SensitiveInfo[] = [];
    for (const opt of this.options) {
      if (opt.action !== "DROP" && opt.value !== undefined) {
        sensitive.push({
          type: "server_option",
          objectType: "server",
          objectName: this.server.name,
          field: opt.option,
          placeholder: `__OPTION_${opt.option.toUpperCase()}__`,
          instruction: `Replace __OPTION_${opt.option.toUpperCase()}__ with the actual ${opt.option} value for server ${this.server.name}.`,
        });
      }
    }
    return sensitive;
  }

  serialize(): string {
    const optionParts: string[] = [];
    const hasOptions = this.sensitiveInfo.length > 0;

    for (const opt of this.options) {
      if (opt.action === "DROP") {
        optionParts.push(`DROP ${opt.option}`);
      } else {
        // Mask all option values with placeholders
        const value =
          opt.value !== undefined
            ? `__OPTION_${opt.option.toUpperCase()}__`
            : "";
        optionParts.push(`${opt.action} ${opt.option} ${quoteLiteral(value)}`);
      }
    }

    const commentParts: string[] = [];
    const sqlParts: string[] = [];

    // Add warning comment if options are present
    if (hasOptions) {
      const optionKeys = this.sensitiveInfo.map((s) => s.field).join(", ");
      commentParts.push(
        `-- WARNING: Server options contain values (${optionKeys})`,
        `-- Replace placeholders below with actual values`,
      );
    }

    sqlParts.push(
      "ALTER SERVER",
      this.server.name,
      "OPTIONS",
      `(${optionParts.join(", ")})`,
    );

    const sql = sqlParts.join(" ");
    return commentParts.length > 0 ? `${commentParts.join("\n")}\n${sql}` : sql;
  }
}
