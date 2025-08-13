import { describe, expect, test } from "vitest";
import {
  AlterRlsPolicyChangeOwner,
  ReplaceRlsPolicy,
} from "./changes/rls-policy.alter.ts";
import { CreateRlsPolicy } from "./changes/rls-policy.create.ts";
import { DropRlsPolicy } from "./changes/rls-policy.drop.ts";
import { diffRlsPolicies } from "./rls-policy.diff.ts";
import { RlsPolicy, type RlsPolicyProps } from "./rls-policy.model.ts";

const base: RlsPolicyProps = {
  schema: "public",
  name: "p1",
  table_schema: "public",
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

  test("alter owner", () => {
    const main = new RlsPolicy(base);
    const branch = new RlsPolicy({ ...base, owner: "o2" });
    const changes = diffRlsPolicies(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterRlsPolicyChangeOwner);
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
