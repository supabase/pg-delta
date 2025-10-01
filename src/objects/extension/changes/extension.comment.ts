import { Change, quoteLiteral } from "../../base.change.ts";
import type { Extension } from "../extension.model.ts";

/**
 * Create/drop comments on extensions.
 */
export class CreateCommentOnExtension extends Change {
  public readonly extension: Extension;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "extension" as const;

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

export class DropCommentOnExtension extends Change {
  public readonly extension: Extension;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "extension" as const;

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
