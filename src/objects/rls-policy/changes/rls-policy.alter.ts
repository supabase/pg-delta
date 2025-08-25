import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";
import { CreateRlsPolicy } from "./rls-policy.create.ts";
import { DropRlsPolicy } from "./rls-policy.drop.ts";

/**
 * Alter an RLS policy.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterpolicy.html
 *
 * Synopsis
 * ```sql
 * ALTER POLICY name ON table_name
 *     [ TO { role_name | PUBLIC | CURRENT_ROLE | CURRENT_USER | SESSION_USER } [, ...] ]
 *     [ USING ( using_expression ) ]
 *     [ WITH CHECK ( with_check_expression ) ]
 * ```
 */
export type AlterRlsPolicy = AlterRlsPolicyChangeOwner;

/**
 * ALTER POLICY ... OWNER TO ...
 */
export class AlterRlsPolicyChangeOwner extends AlterChange {
  public readonly main: RlsPolicy;
  public readonly branch: RlsPolicy;

  constructor(props: { main: RlsPolicy; branch: RlsPolicy }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER POLICY",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "ON",
      `${quoteIdentifier(this.main.table_schema)}.${quoteIdentifier(this.main.table_name)}`,
      "OWNER TO",
      quoteIdentifier(this.branch.owner),
    ].join(" ");
  }
}

/**
 * Replace an RLS policy by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER POLICY change.
 */
export class ReplaceRlsPolicy extends ReplaceChange {
  public readonly main: RlsPolicy;
  public readonly branch: RlsPolicy;

  constructor(props: { main: RlsPolicy; branch: RlsPolicy }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropRlsPolicy({ rlsPolicy: this.main });
    const createChange = new CreateRlsPolicy({ rlsPolicy: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
