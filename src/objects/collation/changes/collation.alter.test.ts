import { describe, expect, test } from "vitest";
import { Collation, type CollationProps } from "../collation.model.ts";
import {
  AlterCollationChangeOwner,
  AlterCollationRefreshVersion,
} from "./collation.alter.ts";

describe.concurrent("collation", () => {
  describe("alter", () => {
    test("change owner", () => {
      const base: Omit<CollationProps, "owner"> = {
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
        comment: null,
      };
      const main = new Collation({
        ...base,
        owner: "old_owner",
      });
      const branch = new Collation({
        ...base,
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
      const base: Omit<CollationProps, "version"> = {
        schema: "public",
        name: "test",
        provider: "c",
        is_deterministic: true,
        encoding: 1,
        collate: "en_US",
        locale: "en_US",
        ctype: "test",
        icu_rules: "test",
        comment: null,
        owner: "test",
      };
      const main = new Collation({
        ...base,
        version: "1.0",
      });
      const branch = new Collation({
        ...base,
        version: "2.0",
      });

      const change = new AlterCollationRefreshVersion({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER COLLATION public.test REFRESH VERSION",
      );
    });

    // replace behavior moved into collation.diff.ts as separate Drop + Create
  });
});
