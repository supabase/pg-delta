import { maskSensitiveOptions } from "../../../../sensitive.ts";
import type { SensitiveInfo } from "../../../../sensitive.types.ts";
import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { UserMapping } from "../user-mapping.model.ts";
import { CreateUserMappingChange } from "./user-mapping.base.ts";

/**
 * Create a user mapping.
 *
 * @see https://www.postgresql.org/docs/17/sql-createusermapping.html
 *
 * Synopsis
 * ```sql
 * CREATE USER MAPPING [ IF NOT EXISTS ] FOR { user_name | USER | CURRENT_ROLE | CURRENT_USER | PUBLIC | SESSION_USER }
 *     SERVER server_name
 *     [ OPTIONS ( option 'value' [, ... ] ) ]
 * ```
 */
export class CreateUserMapping extends CreateUserMappingChange {
  public readonly userMapping: UserMapping;
  public readonly scope = "object" as const;

  constructor(props: { userMapping: UserMapping }) {
    super();
    this.userMapping = props.userMapping;
  }

  get creates() {
    return [this.userMapping.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Server dependency
    dependencies.add(stableId.server(this.userMapping.server));

    return Array.from(dependencies);
  }

  get sensitiveInfo(): SensitiveInfo[] {
    const { sensitive } = maskSensitiveOptions(
      this.userMapping.options,
      "user_mapping",
      `${this.userMapping.server}:${this.userMapping.user}`,
    );
    return sensitive;
  }

  serialize(): string {
    const { masked: maskedOptions, sensitive } = maskSensitiveOptions(
      this.userMapping.options,
      "user_mapping",
      `${this.userMapping.server}:${this.userMapping.user}`,
    );

    const commentParts: string[] = [];
    const sqlParts: string[] = [];

    // Add warning comment if options are present (all options are masked)
    if (sensitive.length > 0) {
      const optionKeys = sensitive.map((s) => s.field).join(", ");
      commentParts.push(
        `-- WARNING: User mapping contains options (${optionKeys})`,
        `-- Replace placeholders below or run ALTER USER MAPPING after this script`,
      );
    }

    sqlParts.push("CREATE USER MAPPING FOR");

    // Add user (can be CURRENT_USER, PUBLIC, etc.)
    sqlParts.push(this.userMapping.user);

    // Add SERVER clause
    sqlParts.push("SERVER", this.userMapping.server);

    // Add OPTIONS clause with masked values
    if (maskedOptions && maskedOptions.length > 0) {
      const optionPairs: string[] = [];
      for (let i = 0; i < maskedOptions.length; i += 2) {
        if (i + 1 < maskedOptions.length) {
          optionPairs.push(
            `${maskedOptions[i]} ${quoteLiteral(maskedOptions[i + 1])}`,
          );
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
