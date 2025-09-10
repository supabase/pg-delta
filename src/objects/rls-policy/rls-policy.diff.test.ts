import { describe, expect, test } from "vitest";
import {
  AlterRlsPolicySetRoles,
  AlterRlsPolicySetUsingExpression,
  AlterRlsPolicySetWithCheckExpression,
  ReplaceRlsPolicy,
} from "./changes/rls-policy.alter.ts";
import { CreateRlsPolicy } from "./changes/rls-policy.create.ts";
import { DropRlsPolicy } from "./changes/rls-policy.drop.ts";
import { diffRlsPolicies } from "./rls-policy.diff.ts";
import { RlsPolicy, type RlsPolicyProps } from "./rls-policy.model.ts";

const base: RlsPolicyProps = {
  schema: "public",
  name: "p1",
  table_name: "t",
  command: "r",
  permissive: true,
  roles: ["role1"],
  using_expression: null,
  with_check_expression: null,
  owner: "o1",
};

describe.concurrent("rls-policy.diff", () => {
  test("create and drop", () => {
    const p = new RlsPolicy(base);
    const created = diffRlsPolicies({}, { [p.stableId]: p });
    expect(created[0]).toBeInstanceOf(CreateRlsPolicy);
    const dropped = diffRlsPolicies({ [p.stableId]: p }, {});
    expect(dropped[0]).toBeInstanceOf(DropRlsPolicy);
  });

  test("alter roles", () => {
    const main = new RlsPolicy(base);
    const branch = new RlsPolicy({ ...base, roles: ["r1", "r2"] });
    const changes = diffRlsPolicies(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterRlsPolicySetRoles);
  });

  test("alter USING expression", () => {
    const main = new RlsPolicy({ ...base, using_expression: "old_expr" });
    const branch = new RlsPolicy({ ...base, using_expression: "new_expr" });
    const changes = diffRlsPolicies(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterRlsPolicySetUsingExpression);
  });

  test("alter WITH CHECK expression", () => {
    const main = new RlsPolicy({ ...base, with_check_expression: "old" });
    const branch = new RlsPolicy({ ...base, with_check_expression: "new" });
    const changes = diffRlsPolicies(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterRlsPolicySetWithCheckExpression);
  });

  test("replace on non-alterable change", () => {
    const main = new RlsPolicy(base);
    const branch = new RlsPolicy({ ...base, command: "w" });
    const changes = diffRlsPolicies(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceRlsPolicy);
  });
});
