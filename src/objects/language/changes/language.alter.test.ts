import { describe, expect, test } from "vitest";
import { Language, type LanguageProps } from "../language.model.ts";
import { AlterLanguageChangeOwner } from "./language.alter.ts";

describe.concurrent("language", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<LanguageProps, "owner"> = {
        name: "plpgsql",
        is_trusted: true,
        is_procedural: true,
        call_handler: "plpgsql_call_handler",
        inline_handler: "plpgsql_inline_handler",
        validator: "plpgsql_validator",
        comment: null,
      };
      const main = new Language({
        ...props,
        owner: "old_owner",
      });
      const branch = new Language({
        ...props,
        owner: "new_owner",
      });

      const change = new AlterLanguageChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER LANGUAGE plpgsql OWNER TO new_owner",
      );
    });
  });
});
