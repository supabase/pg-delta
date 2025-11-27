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
      "ALTER USER MAPPING FOR",
      this.userMapping.user,
      "SERVER",
      this.userMapping.server,
      "OPTIONS",
      `(${optionParts.join(", ")})`,
    ].join(" ");
  }
}
