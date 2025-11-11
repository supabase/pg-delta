import { describe, expect, test } from "vitest";
import { stableId } from "../../utils.ts";
import { Rule } from "../rule.model.ts";
import { CreateRule } from "./rule.create.ts";

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

describe("rule.create", () => {
  test("serialize rule definition and track dependencies", () => {
    const rule = makeRule();
    const change = new CreateRule({ rule });

    expect(change.creates).toEqual([rule.stableId]);
    expect(change.requires).toEqual([
      rule.relationStableId,
      ...rule.columns.map((column) =>
        stableId.column(rule.schema, rule.table_name, column),
      ),
    ]);
    expect(change.serialize()).toBe(
      'CREATE RULE "my_rule" AS ON INSERT TO public."my_table" DO INSTEAD NOTHING',
    );
  });

  test("serialize rule definition with or replace override", () => {
    const rule = makeRule({
      definition:
        '  CREATE RULE "my_rule" AS ON INSERT TO public."my_table" DO INSTEAD NOTHING  ',
    });

    const change = new CreateRule({ rule, orReplace: true });

    expect(change.serialize()).toBe(
      'CREATE OR REPLACE RULE "my_rule" AS ON INSERT TO public."my_table" DO INSTEAD NOTHING',
    );
  });
});
