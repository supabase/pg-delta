import type { SensitiveInfo } from "../../../../sensitive.types.ts";
import { quoteLiteral } from "../../../base.change.ts";
import type { UserMapping } from "../user-mapping.model.ts";
import { AlterUserMappingChange } from "./user-mapping.base.ts";

/**
 * Alter a user mapping.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterusermapping.html
 *
 * Synopsis
 * ```sql
 * ALTER USER MAPPING FOR { user_name | USER | CURRENT_ROLE | CURRENT_USER | PUBLIC | SESSION_USER }
 *     SERVER server_name
 *     OPTIONS ( [ ADD | SET | DROP ] option ['value'] [, ... ] )
 * ```
 */

export type AlterUserMapping = AlterUserMappingSetOptions;

/**
 * ALTER USER MAPPING ... OPTIONS ( ADD | SET | DROP ... )
 */
export class AlterUserMappingSetOptions extends AlterUserMappingChange {
  public readonly userMapping: UserMapping;
  public readonly options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>;
  public readonly scope = "object" as const;

  constructor(props: {
    userMapping: UserMapping;
    options: Array<{
      action: "ADD" | "SET" | "DROP";
      option: string;
      value?: string;
    }>;
  }) {
    super();
    this.userMapping = props.userMapping;
    this.options = props.options;
  }

  get requires() {
    return [this.userMapping.stableId];
  }

  get sensitiveInfo(): SensitiveInfo[] {
    const sensitive: SensitiveInfo[] = [];
    for (const opt of this.options) {
      if (opt.action !== "DROP" && opt.value !== undefined) {
        sensitive.push({
          type: "user_mapping_option",
          objectType: "user_mapping",
          objectName: `${this.userMapping.server}:${this.userMapping.user}`,
          field: opt.option,
          placeholder: `__OPTION_${opt.option.toUpperCase()}__`,
          instruction: `Replace __OPTION_${opt.option.toUpperCase()}__ with the actual ${opt.option} value for user mapping ${this.userMapping.user}@${this.userMapping.server}.`,
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
        `-- WARNING: User mapping options contain values (${optionKeys})`,
        `-- Replace placeholders below with actual values`,
      );
    }

    sqlParts.push(
      "ALTER USER MAPPING FOR",
      this.userMapping.user,
      "SERVER",
      this.userMapping.server,
      "OPTIONS",
      `(${optionParts.join(", ")})`,
    );

    const sql = sqlParts.join(" ");
    return commentParts.length > 0 ? `${commentParts.join("\n")}\n${sql}` : sql;
  }
}
