import type { UserMapping } from "../user-mapping.model.ts";
import { DropUserMappingChange } from "./user-mapping.base.ts";

/**
 * Drop a user mapping.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropusermapping.html
 *
 * Synopsis
 * ```sql
 * DROP USER MAPPING [ IF EXISTS ] FOR { user_name | USER | CURRENT_ROLE | CURRENT_USER | PUBLIC | SESSION_USER }
 *     SERVER server_name
 * ```
 */
export class DropUserMapping extends DropUserMappingChange {
  public readonly userMapping: UserMapping;
  public readonly scope = "object" as const;

  constructor(props: { userMapping: UserMapping }) {
    super();
    this.userMapping = props.userMapping;
  }

  get drops() {
    return [this.userMapping.stableId];
  }

  get requires() {
    return [this.userMapping.stableId];
  }

  serialize(): string {
    return [
      "DROP USER MAPPING FOR",
      this.userMapping.user,
      "SERVER",
      this.userMapping.server,
    ].join(" ");
  }
}
