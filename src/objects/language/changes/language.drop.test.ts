import { describe, expect, test } from "vitest";
import { Language } from "../language.model.ts";
import { DropLanguage } from "./language.drop.ts";

describe("language", () => {
  test("drop", () => {
    const language = new Language({
      name: "plpgsql",
      is_trusted: true,
      is_procedural: true,
      call_handler: "plpgsql_call_handler",
      inline_handler: "plpgsql_inline_handler",
      validator: "plpgsql_validator",
      owner: "test",
    });

    const change = new DropLanguage({
      language,
    });

    expect(change.serialize()).toBe("DROP LANGUAGE plpgsql");
  });
});
