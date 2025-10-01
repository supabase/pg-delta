import { Change } from "../../base.change.ts";
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
export class DropDomain extends Change {
  public readonly domain: Domain;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "domain" as const;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get dependencies() {
    return [this.domain.stableId];
  }

  serialize(): string {
    return `DROP DOMAIN ${this.domain.schema}.${this.domain.name}`;
  }
}
