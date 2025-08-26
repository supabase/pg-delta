import { describe, expect, test } from "vitest";
import { Domain } from "../domain.model.ts";
import { CreateDomain } from "./domain.create.ts";

describe("domain", () => {
  test("create minimal", () => {
    const domain = new Domain({
      schema: "public",
      name: "test_domain",
      base_type: "integer",
      base_type_schema: "pg_catalog",
      base_type_str: "integer",
      not_null: false,
      type_modifier: null,
      array_dimensions: null,
      collation: null,
      default_bin: null,
      default_value: null,
      owner: "test",
      constraints: [],
    });

    const change = new CreateDomain({ domain });

    expect(change.serialize()).toBe(
      "CREATE DOMAIN public.test_domain AS integer",
    );
  });

  test("create with all options", () => {
    const domain = new Domain({
      schema: "public",
      name: "test_domain_all",
      base_type: "text",
      base_type_schema: "custom",
      base_type_str: "text",
      not_null: true,
      type_modifier: null,
      array_dimensions: 2,
      collation: "mycoll",
      default_bin: null,
      default_value: "'hello'",
      owner: "test",
      constraints: [
        {
          name: "c1",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE <> ''",
        },
      ],
    });

    const change = new CreateDomain({ domain });

    expect(change.serialize()).toBe(
      `CREATE DOMAIN public.test_domain_all AS custom.text[][] COLLATE mycoll DEFAULT 'hello' NOT NULL CHECK (VALUE <> '')`,
    );
  });
});
