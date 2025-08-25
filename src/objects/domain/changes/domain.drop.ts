import { DropChange, quoteIdentifier } from "../../base.change.ts";
import type { Domain } from "../domain.model.ts";

/**
 * Drop a domain.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropdomain.html
 *
 * Synopsis
 * ```sql
 * DROP DOMAIN [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropDomain extends DropChange {
  public readonly domain: Domain;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get stableId(): string {
    return `${this.domain.stableId}`;
  }

  serialize(): string {
    return `DROP DOMAIN ${quoteIdentifier(this.domain.schema)}.${quoteIdentifier(this.domain.name)}`;
  }
}
