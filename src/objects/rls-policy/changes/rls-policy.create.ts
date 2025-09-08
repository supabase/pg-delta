import { CreateChange } from "../../base.change.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";

/**
 * Create an RLS policy.
 *
 * @see https://www.postgresql.org/docs/17/sql-createpolicy.html
 *
 * Synopsis
 * ```sql
 * CREATE POLICY name ON table_name
 *     [ AS { PERMISSIVE | RESTRICTIVE } ]
 *     [ FOR { ALL | SELECT | INSERT | UPDATE | DELETE } ]
 *     [ TO { role_name | PUBLIC | CURRENT_ROLE | CURRENT_USER | SESSION_USER } [, ...] ]
 *     [ USING ( using_expression ) ]
 *     [ WITH CHECK ( with_check_expression ) ]
 * ```
 */
export class CreateRlsPolicy extends CreateChange {
  public readonly rlsPolicy: RlsPolicy;

  constructor(props: { rlsPolicy: RlsPolicy }) {
    super();
    this.rlsPolicy = props.rlsPolicy;
  }

  get stableId(): string {
    return `${this.rlsPolicy.stableId}`;
  }

  serialize(): string {
    const parts: string[] = ["CREATE POLICY"];

    // Add policy name with schema
    parts.push(`${this.rlsPolicy.schema}.${this.rlsPolicy.name}`);

    // Add ON table
    parts.push("ON", `${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}`);

    // Add AS RESTRICTIVE only if false (default is PERMISSIVE)
    if (!this.rlsPolicy.permissive) {
      parts.push("AS RESTRICTIVE");
    }

    // Add FOR command
    const commandMap: Record<string, string> = {
      r: "FOR SELECT",
      a: "FOR INSERT",
      w: "FOR UPDATE",
      d: "FOR DELETE",
      "*": "FOR ALL",
    };
    // Default is FOR ALL; only print when not default
    if (this.rlsPolicy.command && this.rlsPolicy.command !== "*") {
      parts.push(commandMap[this.rlsPolicy.command]);
    }

    // Add TO roles
    // Default is TO PUBLIC; avoid printing explicit PUBLIC in CREATE
    if (this.rlsPolicy.roles && this.rlsPolicy.roles.length > 0) {
      const onlyPublic =
        this.rlsPolicy.roles.length === 1 &&
        this.rlsPolicy.roles[0].toLowerCase() === "public";
      if (!onlyPublic) {
        parts.push("TO", this.rlsPolicy.roles.join(", "));
      }
    }

    // Add USING expression
    if (this.rlsPolicy.using_expression) {
      parts.push("USING", `(${this.rlsPolicy.using_expression})`);
    }

    // Add WITH CHECK expression
    if (this.rlsPolicy.with_check_expression) {
      parts.push("WITH CHECK", `(${this.rlsPolicy.with_check_expression})`);
    }

    return parts.join(" ");
  }
}
