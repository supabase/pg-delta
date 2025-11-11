import type { Publication } from "../publication.model.ts";
import { DropPublicationChange } from "./publication.base.ts";

/**
 * Drop a logical replication publication.
 *
 * @see https://www.postgresql.org/docs/17/sql-droppublication.html
 */
export class DropPublication extends DropPublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;

  constructor(props: { publication: Publication }) {
    super();
    this.publication = props.publication;
  }

  get drops() {
    return [this.publication.stableId];
  }

  get requires() {
    return [this.publication.stableId];
  }

  serialize(): string {
    return `DROP PUBLICATION ${this.publication.name}`;
  }
}
