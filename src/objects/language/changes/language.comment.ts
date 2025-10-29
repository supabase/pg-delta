import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Language } from "../language.model.ts";
import { CreateLanguageChange, DropLanguageChange } from "./language.base.ts";

export type CommentLanguage = CreateCommentOnLanguage | DropCommentOnLanguage;

/**
 * Create/drop comments on languages.
 */
export class CreateCommentOnLanguage extends CreateLanguageChange {
  public readonly language: Language;
  public readonly scope = "comment" as const;

  constructor(props: { language: Language }) {
    super();
    this.language = props.language;
  }

  get creates() {
    return [stableId.comment(this.language.stableId)];
  }

  get requires() {
    return [this.language.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON LANGUAGE",
      this.language.name,
      "IS",
      quoteLiteral(this.language.comment as string),
    ].join(" ");
  }
}

export class DropCommentOnLanguage extends DropLanguageChange {
  public readonly language: Language;
  public readonly scope = "comment" as const;

  constructor(props: { language: Language }) {
    super();
    this.language = props.language;
  }

  get drops() {
    return [stableId.comment(this.language.stableId)];
  }

  get requires() {
    return [stableId.comment(this.language.stableId), this.language.stableId];
  }

  serialize(): string {
    return ["COMMENT ON LANGUAGE", this.language.name, "IS NULL"].join(" ");
  }
}
