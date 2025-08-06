import { describe, expect, test } from "vitest";
import { Language } from "../language.model.ts";
import { AlterLanguageChangeOwner, ReplaceLanguage } from "./language.alter.ts";

describe.concurrent("language", () => {
  describe("alter", () => {
    test("change owner", () => {
      const main = new Language({
        name: "plpgsql",
        is_trusted: true,
        is_procedural: true,
        call_handler: "plpgsql_call_handler",
        inline_handler: "plpgsql_inline_handler",
        validator: "plpgsql_validator",
        owner: "old_owner",
      });
      const branch = new Language({
        name: "plpgsql",
        is_trusted: true,
        is_procedural: true,
        call_handler: "plpgsql_call_handler",
        inline_handler: "plpgsql_inline_handler",
        validator: "plpgsql_validator",
        owner: "new_owner",
      });

      const change = new AlterLanguageChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER PROCEDURAL LANGUAGE plpgsql OWNER TO new_owner",
      );
    });

    test("replace language", () => {
      const main = new Language({
        name: "plpgsql",
        is_trusted: true,
        is_procedural: true,
        call_handler: "plpgsql_call_handler",
        inline_handler: "plpgsql_inline_handler",
        validator: "plpgsql_validator",
        owner: "test",
      });
      const branch = new Language({
        name: "plpgsql",
        is_trusted: false,
        is_procedural: true,
        call_handler: "plpgsql_call_handler",
        inline_handler: "plpgsql_inline_handler",
        validator: "plpgsql_validator",
        owner: "test",
      });

      const change = new ReplaceLanguage({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP LANGUAGE plpgsql;\nCREATE PROCEDURAL LANGUAGE plpgsql",
      );
    });
  });
});
