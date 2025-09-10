import { describe, expect, test } from "vitest";
import { RlsPolicy, type RlsPolicyProps } from "../rls-policy.model.ts";
import {
  AlterRlsPolicySetRoles,
  AlterRlsPolicySetUsingExpression,
  AlterRlsPolicySetWithCheckExpression,
  ReplaceRlsPolicy,
} from "./rls-policy.alter.ts";

describe.concurrent("rls-policy", () => {
  describe("alter", () => {
    test("change roles", () => {
      const props: Omit<RlsPolicyProps, "roles"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        using_expression: "user_id = current_user_id()",
        with_check_expression: null,
        owner: "owner",
      };
      const main = new RlsPolicy({
        ...props,
        roles: ["public"],
      });
      const branch = new RlsPolicy({
        ...props,
        roles: ["role1", "role2"],
      });

      const change = new AlterRlsPolicySetRoles({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table TO role1, role2",
      );
    });

    test("change roles to PUBLIC (default)", () => {
      const props: Omit<RlsPolicyProps, "roles"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        using_expression: "expr",
        with_check_expression: null,
        owner: "owner",
      };
      const main = new RlsPolicy({
        ...props,
        roles: ["role1"],
      });
      const branch = new RlsPolicy({
        ...props,
        roles: ["public"],
      });

      const change = new AlterRlsPolicySetRoles({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table TO PUBLIC",
      );
    });

    test("replace rls policy", () => {
      const props: Omit<RlsPolicyProps, "permissive"> = {
        schema: "public",
        name: "test_policy",
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
        "DROP POLICY test_policy ON public.test_table;\nCREATE POLICY test_policy ON public.test_table AS RESTRICTIVE FOR SELECT USING (user_id = current_user_id())",
      );
    });

    test("alter using expression", () => {
      const props: Omit<RlsPolicyProps, "using_expression"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        with_check_expression: null,
        owner: "test",
      };
      const main = new RlsPolicy({
        ...props,
        using_expression: "old_expr",
      });
      const branch = new RlsPolicy({
        ...props,
        using_expression: "new_expr",
      });

      const change = new AlterRlsPolicySetUsingExpression({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table USING (new_expr)",
      );
    });

    test("clear using expression -> USING (true)", () => {
      const props: Omit<RlsPolicyProps, "using_expression"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        with_check_expression: null,
        owner: "test",
      };
      const main = new RlsPolicy({
        ...props,
        using_expression: "old_expr",
      });
      const branch = new RlsPolicy({
        ...props,
        using_expression: null,
      });

      const change = new AlterRlsPolicySetUsingExpression({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table USING (true)",
      );
    });

    test("alter with check expression", () => {
      const props: Omit<RlsPolicyProps, "with_check_expression"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        using_expression: "expr",
        owner: "test",
      };
      const main = new RlsPolicy({
        ...props,
        with_check_expression: "old_check",
      });
      const branch = new RlsPolicy({
        ...props,
        with_check_expression: "new_check",
      });

      const change = new AlterRlsPolicySetWithCheckExpression({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table WITH CHECK (new_check)",
      );
    });

    test("clear with check expression -> WITH CHECK (true)", () => {
      const props: Omit<RlsPolicyProps, "with_check_expression"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        using_expression: "expr",
        owner: "test",
      };
      const main = new RlsPolicy({
        ...props,
        with_check_expression: "old_check",
      });
      const branch = new RlsPolicy({
        ...props,
        with_check_expression: null,
      });

      const change = new AlterRlsPolicySetWithCheckExpression({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table WITH CHECK (true)",
      );
    });
  });
});
