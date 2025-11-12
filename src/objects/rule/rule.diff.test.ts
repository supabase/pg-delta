import { describe, expect, test } from "vitest";
import { ReplaceRule, SetRuleEnabledState } from "./changes/rule.alter.ts";
import {
  CreateCommentOnRule,
  DropCommentOnRule,
} from "./changes/rule.comment.ts";
import { CreateRule } from "./changes/rule.create.ts";
import { DropRule } from "./changes/rule.drop.ts";
import { diffRules } from "./rule.diff.ts";
import { Rule, type RuleProps } from "./rule.model.ts";

const baseRule: RuleProps = {
  schema: "public",
  name: '"my_rule"',
  table_name: '"my_table"',
  relation_kind: "r",
  event: "INSERT",
  enabled: "O",
  is_instead: true,
  definition:
    'CREATE RULE "my_rule" AS ON INSERT TO public."my_table" DO INSTEAD NOTHING',
  comment: null,
  columns: ["id"],
  owner: "o1",
};

describe.concurrent("rule.diff", () => {
  test("create rule", () => {
    const rule = new Rule(baseRule);
    const changes = diffRules({}, { [rule.stableId]: rule });
    expect(changes[0]).toBeInstanceOf(CreateRule);
  });

  test("drop rule", () => {
    const rule = new Rule(baseRule);
    const changes = diffRules({ [rule.stableId]: rule }, {});
    expect(changes[0]).toBeInstanceOf(DropRule);
  });

  test("replace when definition changes", () => {
    const main = new Rule(baseRule);
    const branch = new Rule({
      ...baseRule,
      definition:
        'CREATE RULE "my_rule" AS ON INSERT TO public."my_table" DO ALSO NOTHING',
      is_instead: false,
      columns: ["id", "amount"],
    });
    const changes = diffRules(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((change) => change instanceof ReplaceRule)).toBe(true);
  });

  test("handle comment changes", () => {
    const main = new Rule({ ...baseRule, comment: "old comment" });
    const branch = new Rule({ ...baseRule, comment: "new comment" });
    const changes = diffRules(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((change) => change instanceof CreateCommentOnRule),
    ).toBe(true);
    expect(changes.some((change) => change instanceof DropCommentOnRule)).toBe(
      false,
    );
  });

  test("handle comment removal", () => {
    const main = new Rule({ ...baseRule, comment: "old comment" });
    const branch = new Rule(baseRule);
    const changes = diffRules(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(DropCommentOnRule);
  });

  test("handle enabled state changes", () => {
    const main = new Rule(baseRule);
    const branch = new Rule({ ...baseRule, enabled: "D" });
    const changes = diffRules(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((change) => change instanceof SetRuleEnabledState),
    ).toBe(true);
  });

  test("reapply comment when replacing rule", () => {
    const main = new Rule({ ...baseRule, comment: "my comment" });
    const branch = new Rule({
      ...baseRule,
      definition:
        'CREATE RULE "my_rule" AS ON INSERT TO public."my_table" DO ALSO NOTHING',
      is_instead: false,
      comment: "my comment",
      columns: ["id", "balance"],
    });
    const changes = diffRules(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((change) => change instanceof ReplaceRule)).toBe(true);
    expect(
      changes.some((change) => change instanceof CreateCommentOnRule),
    ).toBe(true);
  });

  test("reapply enabled state when replacing rule", () => {
    const main = new Rule({ ...baseRule, enabled: "D" });
    const branch = new Rule({
      ...baseRule,
      definition:
        'CREATE RULE "my_rule" AS ON INSERT TO public."my_table" DO ALSO NOTHING',
      is_instead: false,
      enabled: "D",
      columns: ["id", "balance"],
    });
    const changes = diffRules(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((change) => change instanceof ReplaceRule)).toBe(true);
    expect(
      changes.some((change) => change instanceof SetRuleEnabledState),
    ).toBe(true);
  });
});
