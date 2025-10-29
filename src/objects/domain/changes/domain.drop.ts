import type { Domain } from "../domain.model.ts";
import { DropDomainChange } from "./domain.base.ts";

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
export class DropDomain extends DropDomainChange {
  public readonly domain: Domain;
  public readonly scope = "object" as const;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get requires() {
    return [this.domain.stableId];
  }

  get drops() {
    return [this.domain.stableId];
  }

  serialize(): string {
    return `DROP DOMAIN ${this.domain.schema}.${this.domain.name}`;
  }
}
