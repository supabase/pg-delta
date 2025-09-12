import { describe, expect, test } from "vitest";
import { Language, type LanguageProps } from "../language.model.ts";
import { AlterLanguageChangeOwner, ReplaceLanguage } from "./language.alter.ts";

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

    test("replace language", () => {
      const props: Omit<LanguageProps, "is_trusted"> = {
        name: "plpgsql",
        is_procedural: true,
        call_handler: "plpgsql_call_handler",
        inline_handler: "plpgsql_inline_handler",
        validator: "plpgsql_validator",
        owner: "test",
      };
      const main = new Language({
        ...props,
        is_trusted: true,
      });
      const branch = new Language({
        ...props,
        is_trusted: false,
      });

      const change = new ReplaceLanguage({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "CREATE OR REPLACE LANGUAGE plpgsql HANDLER plpgsql_call_handler INLINE plpgsql_inline_handler VALIDATOR plpgsql_validator",
      );
    });
  });
});
