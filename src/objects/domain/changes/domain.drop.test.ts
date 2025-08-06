import { describe, expect, test } from "vitest";
import { Domain } from "../domain.model.ts";
import { DropDomain } from "./domain.drop.ts";

describe("domain", () => {
  test("drop", () => {
    const domain = new Domain({
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

    const change = new DropDomain({
      domain,
    });

    expect(change.serialize()).toBe("DROP DOMAIN public.test_domain");
  });
});
