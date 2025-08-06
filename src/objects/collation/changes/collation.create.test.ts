import { describe, expect, test } from "vitest";
import { Collation } from "../collation.model.ts";
import { CreateCollation } from "./collation.create.ts";

describe("collation", () => {
  test("create", () => {
    const collation = new Collation({
      schema: "public",
      name: "test",
      provider: "c",
      is_deterministic: true,
      encoding: 1,
      collate: "en_US",
      locale: "en_US",
      version: "1.0",
      ctype: "test",
      icu_rules: "test",
      owner: "test",
    });

    const change = new CreateCollation({
      collation,
    });

    expect(change.serialize()).toBe(
      `CREATE COLLATION public.test (LOCALE = "en_US", LC_COLLATE = "en_US", LC_CTYPE = test, PROVIDER = libc, DETERMINISTIC = true, RULES = test, VERSION = "1.0")`,
    );
  });
});
