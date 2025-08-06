import { describe, expect, test } from "vitest";
import { Collation } from "../collation.model.ts";
import {
  AlterCollationChangeOwner,
  AlterCollationRefreshVersion,
} from "./collation.alter.ts";

describe.concurrent("collation", () => {
  describe("alter", () => {
    test("change owner", () => {
      const main = new Collation({
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
        owner: "old_owner",
      });
      const branch = new Collation({
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
        owner: "new_owner",
      });

      const change = new AlterCollationChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER COLLATION public.test OWNER TO new_owner",
      );
    });

    test("refresh version", () => {
      const main = new Collation({
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
      const branch = new Collation({
        schema: "public",
        name: "test",
        provider: "c",
        is_deterministic: true,
        encoding: 1,
        collate: "en_US",
        locale: "en_US",
        version: "2.0",
        ctype: "test",
        icu_rules: "test",
        owner: "test",
      });

      const change = new AlterCollationRefreshVersion({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER COLLATION public.test REFRESH VERSION",
      );
    });
  });
});
