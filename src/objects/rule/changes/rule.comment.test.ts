import { describe, expect, test } from "vitest";
import { stableId } from "../../utils.ts";
import { Rule } from "../rule.model.ts";
import { CreateCommentOnRule, DropCommentOnRule } from "./rule.comment.ts";

type RuleProps = ConstructorParameters<typeof Rule>[0];

const base: RuleProps = {
  schema: "public",
  name: '"my_rule"',
  table_name: '"my_table"',
  relation_kind: "r",
  event: "INSERT",
  enabled: "O",
  is_instead: true,
  owner: "owner1",
  definition:
    'CREATE RULE "my_rule" AS ON INSERT TO public."my_table" DO INSTEAD NOTHING',
  comment: null,
  columns: ["id"],
};

const makeRule = (override: Partial<RuleProps> = {}) =>
  new Rule({
    ...base,
    ...override,
    columns: override.columns ? [...override.columns] : [...base.columns],
  });

describe("rule.comment", () => {
  test("create comment serializes and tracks dependencies", () => {
    const rule = makeRule({ comment: "rule's description" });
    const change = new CreateCommentOnRule({ rule });

    expect(change.creates).toEqual([stableId.comment(rule.stableId)]);
    expect(change.requires).toEqual([rule.stableId]);
    expect(change.serialize()).toBe(
      "COMMENT ON RULE \"my_rule\" ON public.\"my_table\" IS 'rule''s description'",
    );
  });

  test("drop comment serializes and tracks dependencies", () => {
    const rule = makeRule({ comment: "temporary comment" });
    const change = new DropCommentOnRule({ rule });

    expect(change.drops).toEqual([stableId.comment(rule.stableId)]);
    expect(change.requires).toEqual([
      stableId.comment(rule.stableId),
      rule.stableId,
    ]);
    expect(change.serialize()).toBe(
      'COMMENT ON RULE "my_rule" ON public."my_table" IS NULL',
    );
  });
});
