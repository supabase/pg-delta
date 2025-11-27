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

  serialize(): string {
    const optionParts: string[] = [];
    for (const opt of this.options) {
      if (opt.action === "DROP") {
        optionParts.push(`DROP ${opt.option}`);
      } else {
        const value = opt.value !== undefined ? quoteLiteral(opt.value) : "";
        optionParts.push(`${opt.action} ${opt.option} ${value}`.trim());
      }
    }

    return [
      "ALTER SERVER",
      this.server.name,
      "OPTIONS",
      `(${optionParts.join(", ")})`,
    ].join(" ");
  }
}
