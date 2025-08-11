import { describe, expect, test } from "vitest";
import { RlsPolicy } from "../rls-policy.model.ts";
import { CreateRlsPolicy } from "./rls-policy.create.ts";

describe("rls-policy", () => {
  test("create", () => {
    const rlsPolicy = new RlsPolicy({
      schema: "public",
      name: "test_policy",
      table_schema: "public",
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
      "CREATE POLICY public.test_policy ON public.test_table FOR SELECT TO public USING (user_id = current_user_id())",
    );
  });
});
