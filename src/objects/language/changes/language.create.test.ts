import { describe, expect, test } from "vitest";
import { Language } from "../language.model.ts";
import { CreateLanguage } from "./language.create.ts";

describe("language", () => {
  test("create", () => {
    const language = new Language({
      name: "plpgsql",
      is_trusted: true,
      is_procedural: true,
      call_handler: "plpgsql_call_handler",
      inline_handler: "plpgsql_inline_handler",
      validator: "plpgsql_validator",
      owner: "test",
    });

    const change = new CreateLanguage({
      language,
    });

    expect(change.serialize()).toBe(
      "CREATE TRUSTED LANGUAGE plpgsql HANDLER plpgsql_call_handler INLINE plpgsql_inline_handler VALIDATOR plpgsql_validator",
    );
  });
});
