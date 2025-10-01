import { Change, quoteLiteral } from "../../base.change.ts";
import type { View } from "../view.model.ts";

export class CreateCommentOnView extends Change {
  public readonly view: View;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "view" as const;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  get dependencies() {
    return [`comment:${this.view.schema}.${this.view.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON VIEW",
      `${this.view.schema}.${this.view.name}`,
      "IS",
      quoteLiteral(this.view.comment as string),
    ].join(" ");
  }
}

export class DropCommentOnView extends Change {
  public readonly view: View;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "view" as const;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  get dependencies() {
    return [`comment:${this.view.schema}.${this.view.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON VIEW",
      `${this.view.schema}.${this.view.name}`,
      "IS NULL",
    ].join(" ");
  }
}
