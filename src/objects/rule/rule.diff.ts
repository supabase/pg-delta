import { diffObjects } from "../base.diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import { ReplaceRule, SetRuleEnabledState } from "./changes/rule.alter.ts";
import {
  CreateCommentOnRule,
  DropCommentOnRule,
} from "./changes/rule.comment.ts";
import { CreateRule } from "./changes/rule.create.ts";
import { DropRule } from "./changes/rule.drop.ts";
import type { RuleChange } from "./changes/rule.types.ts";
import type { Rule } from "./rule.model.ts";

export function diffRules(
  main: Record<string, Rule>,
  branch: Record<string, Rule>,
): RuleChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);
  const changes: RuleChange[] = [];

  for (const id of created) {
    const rule = branch[id];
    changes.push(new CreateRule({ rule }));

    if (rule.comment !== null) {
      changes.push(new CreateCommentOnRule({ rule }));
    }

    if (rule.enabled !== "O") {
      changes.push(new SetRuleEnabledState({ rule }));
    }
  }

  for (const id of dropped) {
    changes.push(new DropRule({ rule: main[id] }));
  }

  for (const id of altered) {
    const mainRule = main[id];
    const branchRule = branch[id];

    const NON_ALTERABLE_FIELDS: Array<keyof Rule> = [
      "definition",
      "event",
      "is_instead",
    ];

    const shouldReplace = hasNonAlterableChanges(
      mainRule,
      branchRule,
      NON_ALTERABLE_FIELDS,
      { columns: deepEqual },
    );

    const replaced = shouldReplace;

    if (shouldReplace) {
      changes.push(new ReplaceRule({ rule: branchRule }));
    }

    if (mainRule.comment !== branchRule.comment) {
      if (branchRule.comment === null) {
        changes.push(new DropCommentOnRule({ rule: mainRule }));
      } else {
        changes.push(new CreateCommentOnRule({ rule: branchRule }));
      }
    } else if (replaced && branchRule.comment !== null) {
      changes.push(new CreateCommentOnRule({ rule: branchRule }));
    }

    if (
      mainRule.enabled !== branchRule.enabled ||
      (replaced && branchRule.enabled !== "O")
    ) {
      changes.push(new SetRuleEnabledState({ rule: branchRule }));
    }
  }

  return changes;
}
