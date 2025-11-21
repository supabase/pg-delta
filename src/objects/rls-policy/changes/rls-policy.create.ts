import { stableId } from "../../utils.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";
import { CreateRlsPolicyChange } from "./rls-policy.base.ts";

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
export class CreateRlsPolicy extends CreateRlsPolicyChange {
  public readonly policy: RlsPolicy;
  public readonly scope = "object" as const;

  constructor(props: { policy: RlsPolicy }) {
    super();
    this.policy = props.policy;
  }

  get creates() {
    return [this.policy.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.policy.schema));

    // Table dependency
    dependencies.add(
      stableId.table(this.policy.schema, this.policy.table_name),
    );

    // Owner dependency
    dependencies.add(stableId.role(this.policy.owner));

    return Array.from(dependencies);
  }

  serialize(): string {
    const parts: string[] = ["CREATE POLICY"];

    // Add policy name
    parts.push(this.policy.name);

    // Add ON table
    parts.push("ON", `${this.policy.schema}.${this.policy.table_name}`);

    // Add AS RESTRICTIVE only if false (default is PERMISSIVE)
    if (!this.policy.permissive) {
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
    if (this.policy.command && this.policy.command !== "*") {
      parts.push(commandMap[this.policy.command]);
    }

    // Add TO roles
    // Default is TO PUBLIC; avoid printing explicit PUBLIC in CREATE
    if (this.policy.roles && this.policy.roles.length > 0) {
      const onlyPublic =
        this.policy.roles.length === 1 &&
        this.policy.roles[0].toLowerCase() === "public";
      if (!onlyPublic) {
        parts.push("TO", this.policy.roles.join(", "));
      }
    }

    // Add USING expression
    if (this.policy.using_expression) {
      parts.push("USING", `(${this.policy.using_expression})`);
    }

    // Add WITH CHECK expression
    if (this.policy.with_check_expression) {
      parts.push("WITH CHECK", `(${this.policy.with_check_expression})`);
    }

    return parts.join(" ");
  }
}
