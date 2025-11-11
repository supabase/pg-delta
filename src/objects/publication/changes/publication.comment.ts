import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Publication } from "../publication.model.ts";
import {
  CreatePublicationChange,
  DropPublicationChange,
} from "./publication.base.ts";

export type CommentPublication =
  | CreateCommentOnPublication
  | DropCommentOnPublication;

export class CreateCommentOnPublication extends CreatePublicationChange {
  public readonly publication: Publication;
  public readonly scope = "comment" as const;

  constructor(props: { publication: Publication }) {
    super();
    this.publication = props.publication;
  }

  get creates() {
    return [stableId.comment(this.publication.stableId)];
  }

  get requires() {
    return [this.publication.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON PUBLICATION",
      this.publication.name,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: comment ensured non-null by caller
      quoteLiteral(this.publication.comment!),
    ].join(" ");
  }
}

export class DropCommentOnPublication extends DropPublicationChange {
  public readonly publication: Publication;
  public readonly scope = "comment" as const;

  constructor(props: { publication: Publication }) {
    super();
    this.publication = props.publication;
  }

  get drops() {
    return [stableId.comment(this.publication.stableId)];
  }

  get requires() {
    return [
      stableId.comment(this.publication.stableId),
      this.publication.stableId,
    ];
  }

  serialize(): string {
    return `COMMENT ON PUBLICATION ${this.publication.name} IS NULL`;
  }
}
