import { maskSensitiveOptions } from "../../../../sensitive.ts";
import type { SensitiveInfo } from "../../../../sensitive.types.ts";
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

  get sensitiveInfo(): SensitiveInfo[] {
    const { sensitive } = maskSensitiveOptions(
      this.server.options,
      "server",
      this.server.name,
    );
    return sensitive;
  }

  serialize(): string {
    const { masked: maskedOptions, sensitive } = maskSensitiveOptions(
      this.server.options,
      "server",
      this.server.name,
    );

    const commentParts: string[] = [];
    const sqlParts: string[] = [];

    // Add warning comment if options are present (all options are masked)
    if (sensitive.length > 0) {
      const optionKeys = sensitive.map((s) => s.field).join(", ");
      commentParts.push(
        `-- WARNING: Server contains options (${optionKeys})`,
        `-- Replace placeholders below or run ALTER SERVER ${this.server.name} after this script`,
      );
    }

    sqlParts.push("CREATE SERVER");

    // Add server name
    sqlParts.push(this.server.name);

    // Add TYPE clause
    if (this.server.type) {
      sqlParts.push("TYPE", quoteLiteral(this.server.type));
    }

    // Add VERSION clause
    if (this.server.version) {
      sqlParts.push("VERSION", quoteLiteral(this.server.version));
    }

    // Add FOREIGN DATA WRAPPER clause
    sqlParts.push("FOREIGN DATA WRAPPER", this.server.foreign_data_wrapper);

    // Add OPTIONS clause with masked values
    if (maskedOptions && maskedOptions.length > 0) {
      const optionPairs: string[] = [];
      for (let i = 0; i < maskedOptions.length; i += 2) {
        if (i + 1 < maskedOptions.length) {
          const key = maskedOptions[i];
          const value = maskedOptions[i + 1];
          optionPairs.push(`${key} ${quoteLiteral(value)}`);
        }
      }
      if (optionPairs.length > 0) {
        sqlParts.push(`OPTIONS (${optionPairs.join(", ")})`);
      }
    }

    const sql = sqlParts.join(" ");
    return commentParts.length > 0 ? `${commentParts.join("\n")}\n${sql}` : sql;
  }
}
