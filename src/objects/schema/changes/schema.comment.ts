import { Change, quoteLiteral } from "../../base.change.ts";
import type { Schema } from "../schema.model.ts";

export class CreateCommentOnSchema extends Change {
  public readonly schemaObj: Schema;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "schema" as const;

  constructor(props: { schemaObj: Schema }) {
    super();
    this.schemaObj = props.schemaObj;
  }

  get dependencies() {
    return [`comment:${this.schemaObj.schema}`];
  }

  serialize(): string {
    return [
      "COMMENT ON SCHEMA",
      this.schemaObj.schema,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: schema comment is not nullable in this case
      quoteLiteral(this.schemaObj.comment!),
    ].join(" ");
  }
}

export class DropCommentOnSchema extends Change {
  public readonly schemaObj: Schema;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "schema" as const;

  constructor(props: { schemaObj: Schema }) {
    super();
    this.schemaObj = props.schemaObj;
  }

  get dependencies() {
    return [`comment:${this.schemaObj.schema}`];
  }

  serialize(): string {
    return ["COMMENT ON SCHEMA", this.schemaObj.schema, "IS NULL"].join(" ");
  }
}
