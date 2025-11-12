import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Domain } from "../domain.model.ts";
import { CreateDomainChange, DropDomainChange } from "./domain.base.ts";

export type CommentDomain = CreateCommentOnDomain | DropCommentOnDomain;

/**
 * Create/drop comments on domains.
 */
export class CreateCommentOnDomain extends CreateDomainChange {
  public readonly domain: Domain;
  public readonly scope = "comment" as const;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get creates() {
    return [stableId.comment(this.domain.stableId)];
  }

  get requires() {
    return [this.domain.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON DOMAIN",
      `${this.domain.schema}.${this.domain.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: domain comment is not nullable in this case
      quoteLiteral(this.domain.comment!),
    ].join(" ");
  }
}

export class DropCommentOnDomain extends DropDomainChange {
  public readonly domain: Domain;
  public readonly scope = "comment" as const;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get requires() {
    return [stableId.comment(this.domain.stableId), this.domain.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON DOMAIN",
      `${this.domain.schema}.${this.domain.name}`,
      "IS NULL",
    ].join(" ");
  }
}
