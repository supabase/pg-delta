import type { ReplaceRule, SetRuleEnabledState } from "./rule.alter.ts";
import type { CreateCommentOnRule, DropCommentOnRule } from "./rule.comment.ts";
import type { CreateRule } from "./rule.create.ts";
import type { DropRule } from "./rule.drop.ts";

export type RuleChange =
  | CreateRule
  | DropRule
  | ReplaceRule
  | SetRuleEnabledState
  | CreateCommentOnRule
  | DropCommentOnRule;
