import { describe, expect, test } from "vitest";
import { RlsPolicy } from "../rls-policy.model.ts";
import { DropRlsPolicy } from "./rls-policy.drop.ts";

describe("rls-policy", () => {
  test("drop", () => {
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

    const change = new DropRlsPolicy({
      rlsPolicy,
    });

    expect(change.serialize()).toBe(
      "DROP POLICY test_policy ON public.test_table",
    );
  });
});
