import { describe, expect, test } from "vitest";
import { RlsPolicy } from "../rls-policy.model.ts";
import {
  AlterRlsPolicyChangeOwner,
  ReplaceRlsPolicy,
} from "./rls-policy.alter.ts";

describe.concurrent("rls-policy", () => {
  describe("alter", () => {
    test("change owner", () => {
      const main = new RlsPolicy({
        schema: "public",
        name: "test_policy",
        table_schema: "public",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        using_expression: "user_id = current_user_id()",
        with_check_expression: null,
        owner: "old_owner",
      });
      const branch = new RlsPolicy({
        schema: "public",
        name: "test_policy",
        table_schema: "public",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        using_expression: "user_id = current_user_id()",
        with_check_expression: null,
        owner: "new_owner",
      });

      const change = new AlterRlsPolicyChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY test_policy ON public . test_table OWNER TO new_owner",
      );
    });

    test("replace rls policy", () => {
      const main = new RlsPolicy({
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
      const branch = new RlsPolicy({
        schema: "public",
        name: "test_policy",
        table_schema: "public",
        table_name: "test_table",
        command: "r",
        permissive: false,
        roles: ["public"],
        using_expression: "user_id = current_user_id()",
        with_check_expression: null,
        owner: "test",
      });

      const change = new ReplaceRlsPolicy({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP POLICY test_policy ON public.test_table;\nCREATE POLICY test_policy ON public.test_table FOR SELECT TO public USING (user_id = current_user_id())",
      );
    });
  });
});
