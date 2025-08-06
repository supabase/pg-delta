import { describe, expect, test } from "vitest";
import { Collation } from "../collation.model.ts";
import { DropCollation } from "./collation.drop.ts";

describe("collation", () => {
  test("drop", () => {
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

    const change = new DropCollation({
      collation,
    });

    expect(change.serialize()).toBe("DROP COLLATION public.test");
  });
});
