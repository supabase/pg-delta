import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Extension } from "../extension.model.ts";
import {
  CreateExtensionChange,
  DropExtensionChange,
} from "./extension.base.ts";

export type CommentExtension =
  | CreateCommentOnExtension
  | DropCommentOnExtension;

/**
 * Create/drop comments on extensions.
 */
export class CreateCommentOnExtension extends CreateExtensionChange {
  public readonly extension: Extension;
  public readonly scope = "comment" as const;

  constructor(props: { extension: Extension }) {
    super();
    this.extension = props.extension;
  }

  get creates() {
    return [stableId.comment(this.extension.stableId)];
  }

  get requires() {
    return [this.extension.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON EXTENSION",
      this.extension.name,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: extension comment is not nullable here
      quoteLiteral(this.extension.comment!),
    ].join(" ");
  }
}

export class DropCommentOnExtension extends DropExtensionChange {
  public readonly extension: Extension;
  public readonly scope = "comment" as const;

  constructor(props: { extension: Extension }) {
    super();
    this.extension = props.extension;
  }

  get drops() {
    return [stableId.comment(this.extension.stableId)];
  }

  get requires() {
    return [stableId.comment(this.extension.stableId), this.extension.stableId];
  }

  serialize(): string {
    return ["COMMENT ON EXTENSION", this.extension.name, "IS NULL"].join(" ");
  }
}
