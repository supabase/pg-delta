import { describe, expect, test } from "vitest";
import { RlsPolicy, type RlsPolicyProps } from "../rls-policy.model.ts";
import {
  AlterRlsPolicyChangeOwner,
  ReplaceRlsPolicy,
} from "./rls-policy.alter.ts";

describe.concurrent("rls-policy", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<RlsPolicyProps, "owner"> = {
        schema: "public",
        name: "test_policy",
        table_schema: "public",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        using_expression: "user_id = current_user_id()",
        with_check_expression: null,
      };
      const main = new RlsPolicy({
        ...props,
        owner: "old_owner",
      });
      const branch = new RlsPolicy({
        ...props,
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
      const props: Omit<RlsPolicyProps, "permissive"> = {
        schema: "public",
        name: "test_policy",
        table_schema: "public",
        table_name: "test_table",
        command: "r",
        roles: ["public"],
        using_expression: "user_id = current_user_id()",
        with_check_expression: null,
        owner: "test",
      };
      const main = new RlsPolicy({
        ...props,
        permissive: true,
      });
      const branch = new RlsPolicy({
        ...props,
        permissive: false,
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
