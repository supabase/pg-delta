import { DropChange } from "../../base.change.ts";
import type { View } from "../view.model.ts";

/**
 * Drops a view from the database.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropview.html
 */
export class DropView extends DropChange {
  public readonly view: View;

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
