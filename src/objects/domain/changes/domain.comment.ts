import { Change, quoteLiteral } from "../../base.change.ts";
import type { Domain } from "../domain.model.ts";

/**
 * Create/drop comments on domains.
 */
export class CreateCommentOnDomain extends Change {
  public readonly domain: Domain;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "domain" as const;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get dependencies() {
    return [`comment:${this.domain.schema}.${this.domain.name}`];
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

export class DropCommentOnDomain extends Change {
  public readonly domain: Domain;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "domain" as const;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get dependencies() {
    return [`comment:${this.domain.schema}.${this.domain.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON DOMAIN",
      `${this.domain.schema}.${this.domain.name}`,
      "IS NULL",
    ].join(" ");
  }
}
