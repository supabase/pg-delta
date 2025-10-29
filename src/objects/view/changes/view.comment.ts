import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { View } from "../view.model.ts";
import { CreateViewChange, DropViewChange } from "./view.base.ts";

export type CommentView = CreateCommentOnView | DropCommentOnView;

export class CreateCommentOnView extends CreateViewChange {
  public readonly view: View;
  public readonly scope = "comment" as const;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  get creates() {
    return [stableId.comment(this.view.stableId)];
  }

  get requires() {
    return [this.view.stableId];
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

export class DropCommentOnView extends DropViewChange {
  public readonly view: View;
  public readonly scope = "comment" as const;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  get drops() {
    return [stableId.comment(this.view.stableId)];
  }

  get requires() {
    return [stableId.comment(this.view.stableId), this.view.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON VIEW",
      `${this.view.schema}.${this.view.name}`,
      "IS NULL",
    ].join(" ");
  }
}
