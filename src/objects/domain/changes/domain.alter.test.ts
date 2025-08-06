import { describe, expect, test } from "vitest";
import { Domain } from "../domain.model.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainChangeOwner,
  AlterDomainDropConstraint,
  AlterDomainDropDefault,
  AlterDomainDropNotNull,
  AlterDomainRenameConstraint,
  AlterDomainSetDefault,
  AlterDomainSetNotNull,
  AlterDomainValidateConstraint,
} from "./domain.alter.ts";

describe.concurrent("domain", () => {
  describe("alter", () => {
    test("set default", () => {
      const main = new Domain({
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
      });
      const branch = new Domain({
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: "42",
        owner: "test",
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
      const main = new Domain({
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: "42",
        owner: "test",
      });
      const branch = new Domain({
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
      const main = new Domain({
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
      });
      const branch = new Domain({
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: true,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
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
      const main = new Domain({
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: true,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
      });
      const branch = new Domain({
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
      const main = new Domain({
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
        owner: "old_owner",
      });
      const branch = new Domain({
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

    test.skip("add constraint", () => {
      const main = new Domain({
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
      });
      const branch = new Domain({
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
      });

      const change = new AlterDomainAddConstraint({
        main,
        branch,
        constraintName: "test_check",
        constraintDefinition: "CHECK (VALUE > 0)",
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain ADD CONSTRAINT test_check CHECK (VALUE > 0)",
      );
    });

    test.skip("drop constraint", () => {
      const main = new Domain({
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
      });
      const branch = new Domain({
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
      });

      const change = new AlterDomainDropConstraint({
        main,
        branch,
        constraintName: "test_check",
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain DROP CONSTRAINT test_check",
      );
    });

    test.skip("rename constraint", () => {
      const main = new Domain({
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
      });
      const branch = new Domain({
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
      });

      const change = new AlterDomainRenameConstraint({
        main,
        branch,
        oldConstraintName: "old_check",
        newConstraintName: "new_check",
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain RENAME CONSTRAINT old_check TO new_check",
      );
    });

    test.skip("validate constraint", () => {
      const main = new Domain({
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
      });
      const branch = new Domain({
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
      });

      const change = new AlterDomainValidateConstraint({
        main,
        branch,
        constraintName: "test_check",
      });

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain VALIDATE CONSTRAINT test_check",
      );
    });
  });
});
