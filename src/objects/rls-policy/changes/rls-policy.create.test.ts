import { describe, expect, test } from "vitest";
import { RlsPolicy } from "../rls-policy.model.ts";
import { CreateRlsPolicy } from "./rls-policy.create.ts";

describe("rls-policy", () => {
  test("create minimal", () => {
    const rlsPolicy = new RlsPolicy({
      schema: "public",
      name: "test_policy_min",
      table_name: "test_table",
      command: "*",
      permissive: true,
      roles: [],
      using_expression: null,
      with_check_expression: null,
      owner: "test",
    });

    const change = new CreateRlsPolicy({
      rlsPolicy,
    });

    expect(change.serialize()).toBe(
      "CREATE POLICY test_policy_min ON public.test_table",
    );
  });

  test("create", () => {
    const rlsPolicy = new RlsPolicy({
      schema: "public",
      name: "test_policy",
      table_name: "test_table",
      command: "r",
      permissive: true,
      roles: ["public"],
      using_expression: "user_id = current_user_id()",
      with_check_expression: null,
      owner: "test",
    });

    const change = new CreateRlsPolicy({
      rlsPolicy,
    });

    expect(change.serialize()).toBe(
      "CREATE POLICY test_policy ON public.test_table FOR SELECT USING (user_id = current_user_id())",
    );
  });

  test("create with all options", () => {
    const rlsPolicy = new RlsPolicy({
      schema: "public",
      name: "test_policy_all",
      table_name: "test_table",
      command: "w",
      permissive: false,
      roles: ["role1", "role2"],
      using_expression: "expr1",
      with_check_expression: "expr2",
      owner: "test",
    });

    const change = new CreateRlsPolicy({
      rlsPolicy,
    });

    expect(change.serialize()).toBe(
      "CREATE POLICY test_policy_all ON public.test_table AS RESTRICTIVE FOR UPDATE TO role1, role2 USING (expr1) WITH CHECK (expr2)",
    );
  });
});
