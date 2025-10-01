import { Change } from "../../base.change.ts";
import type { Role } from "../role.model.ts";

/**
 * Drop a role.
 *
 * @see https://www.postgresql.org/docs/17/sql-droprole.html
 *
 * Synopsis
 * ```sql
 * DROP ROLE [ IF EXISTS ] name [, ...]
 * ```
 */
export class DropRole extends Change {
  public readonly role: Role;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "role" as const;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  get dependencies() {
    return [this.role.stableId];
  }

  serialize(): string {
    return ["DROP ROLE", this.role.role_name].join(" ");
  }
}
