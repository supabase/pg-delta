import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { Extension } from "../extension.model.ts";
import type { ExtensionChange } from "./extension.base.ts";

/**
 * Create/drop comments on extensions.
 */
export class CreateCommentOnExtension
  extends CreateChange
  implements ExtensionChange
{
  public readonly extension: Extension;
  public readonly category = "extension" as const;

  constructor(props: { extension: Extension }) {
    super();
    this.extension = props.extension;
  }

  get dependencies() {
    return [`comment:${this.extension.name}`];
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

export class DropCommentOnExtension
  extends DropChange
  implements ExtensionChange
{
  public readonly extension: Extension;
  public readonly category = "extension" as const;

  constructor(props: { extension: Extension }) {
    super();
    this.extension = props.extension;
  }

  get dependencies() {
    return [`comment:${this.extension.name}`];
  }

  serialize(): string {
    return ["COMMENT ON EXTENSION", this.extension.name, "IS NULL"].join(" ");
  }
}
