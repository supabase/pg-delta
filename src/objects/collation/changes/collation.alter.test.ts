import { describe, expect, test } from "vitest";
import { Collation, type CollationProps } from "../collation.model.ts";
import {
  AlterCollationChangeOwner,
  AlterCollationRefreshVersion,
} from "./collation.alter.ts";

describe.concurrent("collation", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<CollationProps, "owner"> = {
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
      };
      const main = new Collation({
        ...props,
        owner: "old_owner",
      });
      const branch = new Collation({
        ...props,
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
      const props: Omit<CollationProps, "version"> = {
        schema: "public",
        name: "test",
        provider: "c",
        is_deterministic: true,
        encoding: 1,
        collate: "en_US",
        locale: "en_US",
        ctype: "test",
        icu_rules: "test",
        owner: "test",
      };
      const main = new Collation({
        ...props,
        version: "1.0",
      });
      const branch = new Collation({
        ...props,
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
  });
});
