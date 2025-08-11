import { CreateChange, quoteIdentifier } from "../../base.change.ts";
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

  serialize(): string {
    const parts: string[] = ["CREATE POLICY"];

    // Add policy name with schema
    parts.push(
      `${quoteIdentifier(this.rlsPolicy.schema)}.${quoteIdentifier(this.rlsPolicy.name)}`,
    );

    // Add ON table
    parts.push(
      "ON",
      `${quoteIdentifier(this.rlsPolicy.table_schema)}.${quoteIdentifier(this.rlsPolicy.table_name)}`,
    );

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
    if (this.rlsPolicy.command) {
      parts.push(commandMap[this.rlsPolicy.command] || "FOR ALL");
    }

    // Add TO roles
    if (this.rlsPolicy.roles && this.rlsPolicy.roles.length > 0) {
      parts.push("TO", this.rlsPolicy.roles.map(quoteIdentifier).join(", "));
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
