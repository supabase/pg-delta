import { Change } from "../../base.change.ts";
import type { View } from "../view.model.ts";

/**
 * Drops a view from the database.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropview.html
 */
export class DropView extends Change {
  public readonly view: View;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "view" as const;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  get dependencies() {
    return [this.view.stableId];
  }

  serialize(): string {
    return ["DROP VIEW", `${this.view.schema}.${this.view.name}`].join(" ");
  }
}
