import { describe, expect, test } from "vitest";
import { Domain, type DomainProps } from "../domain.model.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainChangeOwner,
  AlterDomainDropConstraint,
  AlterDomainDropDefault,
  AlterDomainDropNotNull,
  AlterDomainSetDefault,
  AlterDomainSetNotNull,
  AlterDomainValidateConstraint,
} from "./domain.alter.ts";

describe.concurrent("domain", () => {
  describe("alter", () => {
    test("set default", () => {
      const props: Omit<DomainProps, "default_value"> = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        owner: "test",
      };
      const main = new Domain({
        ...props,
        default_value: null,
      });
      const branch = new Domain({
        ...props,
        default_value: "42",
      });

      const change = new AlterDomainSetDefault({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain SET DEFAULT 42",
      );
    });

    test("drop default", () => {
      const props: Omit<DomainProps, "default_value"> = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        owner: "test",
      };
      const main = new Domain({
        ...props,
        default_value: "42",
      });
      const branch = new Domain({
        ...props,
        default_value: null,
      });

      const change = new AlterDomainDropDefault({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain DROP DEFAULT",
      );
    });

    test("set not null", () => {
      const props: Omit<DomainProps, "not_null"> = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
      };
      const main = new Domain({
        ...props,
        not_null: false,
      });
      const branch = new Domain({
        ...props,
        not_null: true,
      });

      const change = new AlterDomainSetNotNull({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain SET NOT NULL",
      );
    });

    test("drop not null", () => {
      const props: Omit<DomainProps, "not_null"> = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
      };
      const main = new Domain({
        ...props,
        not_null: true,
      });
      const branch = new Domain({
        ...props,
        not_null: false,
      });

      const change = new AlterDomainDropNotNull({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain DROP NOT NULL",
      );
    });

    test("change owner", () => {
      const props: Omit<DomainProps, "owner"> = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
      };
      const main = new Domain({
        ...props,
        owner: "old_owner",
      });
      const branch = new Domain({
        ...props,
        owner: "new_owner",
      });

      const change = new AlterDomainChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain OWNER TO new_owner",
      );
    });

    test("add constraint", () => {
      const props: DomainProps = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
      };
      const domain = new Domain(props);

      const change = new AlterDomainAddConstraint({
        domain,
        constraint: {
          name: "test_check",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE > 0",
          owner: "test",
        },
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain ADD CONSTRAINT test_check CHECK (VALUE > 0)",
      );
    });

    test("drop constraint", () => {
      const props: DomainProps = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
      };
      const domain = new Domain(props);

      const change = new AlterDomainDropConstraint({
        domain,
        constraint: {
          name: "test_check",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE > 0",
          owner: "test",
        },
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain DROP CONSTRAINT test_check",
      );
    });

    test("validate constraint", () => {
      const props: DomainProps = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
      };
      const domain = new Domain(props);

      const change = new AlterDomainValidateConstraint({
        domain,
        constraint: {
          name: "test_check",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE > 0",
          owner: "test",
        },
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain VALIDATE CONSTRAINT test_check",
      );
    });
  });
});
