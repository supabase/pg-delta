import { quoteLiteral } from "../../../base.change.ts";
import type { ColumnProps } from "../../../base.model.ts";
import { stableId } from "../../../utils.ts";
import type { CompositeType } from "../composite-type.model.ts";
import {
  CreateCompositeTypeChange,
  DropCompositeTypeChange,
} from "./composite-type.base.ts";

/**
 * Create/drop comments on composite types or their attributes.
 *
 * @see https://www.postgresql.org/docs/17/sql-comment.html
 */

export type CommentCompositeType =
  | CreateCommentOnCompositeType
  | CreateCommentOnCompositeTypeAttribute
  | DropCommentOnCompositeType
  | DropCommentOnCompositeTypeAttribute;

export class CreateCommentOnCompositeType extends CreateCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly scope = "comment" as const;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get creates() {
    return [stableId.comment(this.compositeType.stableId)];
  }

  get requires() {
    return [this.compositeType.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: type comment is not nullable in this case
      quoteLiteral(this.compositeType.comment!),
    ].join(" ");
  }
}

export class DropCommentOnCompositeType extends DropCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly scope = "comment" as const;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get drops() {
    return [stableId.comment(this.compositeType.stableId)];
  }

  get requires() {
    return [
      stableId.comment(this.compositeType.stableId),
      this.compositeType.stableId,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
      "IS NULL",
    ].join(" ");
  }
}

export class CreateCommentOnCompositeTypeAttribute extends CreateCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: ColumnProps;
  public readonly scope = "comment" as const;

  constructor(props: { compositeType: CompositeType; attribute: ColumnProps }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get creates() {
    const attributeStableId = `${this.compositeType.stableId}:${this.attribute.name}`;
    return [stableId.comment(attributeStableId)];
  }

  get requires() {
    return [
      `${this.compositeType.stableId}:${this.attribute.name}`,
      this.compositeType.stableId,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON COLUMN",
      `${this.compositeType.schema}.${this.compositeType.name}.${this.attribute.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: attribute comment is not nullable in this case
      quoteLiteral(this.attribute.comment!),
    ].join(" ");
  }
}

export class DropCommentOnCompositeTypeAttribute extends DropCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: ColumnProps;
  public readonly scope = "comment" as const;

  constructor(props: { compositeType: CompositeType; attribute: ColumnProps }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get drops() {
    const attributeStableId = `${this.compositeType.stableId}:${this.attribute.name}`;
    return [stableId.comment(attributeStableId)];
  }

  get requires() {
    const attributeStableId = `${this.compositeType.stableId}:${this.attribute.name}`;
    return [
      stableId.comment(attributeStableId),
      attributeStableId,
      this.compositeType.stableId,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON COLUMN",
      `${this.compositeType.schema}.${this.compositeType.name}.${this.attribute.name}`,
      "IS NULL",
    ].join(" ");
  }
}
