import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { Server } from "../server.model.ts";
import { CreateServerChange } from "./server.base.ts";

/**
 * Create a server.
 *
 * @see https://www.postgresql.org/docs/17/sql-createserver.html
 *
 * Synopsis
 * ```sql
 * CREATE SERVER [ IF NOT EXISTS ] server_name [ TYPE 'server_type' ] [ VERSION 'server_version' ]
 *     FOREIGN DATA WRAPPER fdw_name
 *     [ OPTIONS ( option 'value' [, ... ] ) ]
 * ```
 */
export class CreateServer extends CreateServerChange {
  public readonly server: Server;
  public readonly scope = "object" as const;

  constructor(props: { server: Server }) {
    super();
    this.server = props.server;
  }

  get creates() {
    return [this.server.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Foreign Data Wrapper dependency
    dependencies.add(
      stableId.foreignDataWrapper(this.server.foreign_data_wrapper),
    );

    // Owner dependency
    dependencies.add(stableId.role(this.server.owner));

    return Array.from(dependencies);
  }

  serialize(): string {
    const parts: string[] = ["CREATE SERVER"];

    // Add server name
    parts.push(this.server.name);

    // Add TYPE clause
    if (this.server.type) {
      parts.push("TYPE", quoteLiteral(this.server.type));
    }

    // Add VERSION clause
    if (this.server.version) {
      parts.push("VERSION", quoteLiteral(this.server.version));
    }

    // Add FOREIGN DATA WRAPPER clause
    parts.push("FOREIGN DATA WRAPPER", this.server.foreign_data_wrapper);

    // Add OPTIONS clause
    if (this.server.options && this.server.options.length > 0) {
      const optionPairs: string[] = [];
      for (let i = 0; i < this.server.options.length; i += 2) {
        if (i + 1 < this.server.options.length) {
          optionPairs.push(
            `${this.server.options[i]} ${quoteLiteral(this.server.options[i + 1])}`,
          );
        }
      }
      if (optionPairs.length > 0) {
        parts.push(`OPTIONS (${optionPairs.join(", ")})`);
      }
    }

    return parts.join(" ");
  }
}
