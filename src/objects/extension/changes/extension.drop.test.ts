import { describe, expect, test } from "vitest";
import { Extension } from "../extension.model.ts";
import { DropExtension } from "./extension.drop.ts";

describe("extension", () => {
  test("drop", () => {
    const extension = new Extension({
      name: "test_extension",
      schema: "public",
      relocatable: true,
      version: "1.0",
      owner: "test",
      comment: null,
      members: [],
    });

    const change = new DropExtension({
      extension,
    });

    expect(change.serialize()).toBe("DROP EXTENSION test_extension");
  });
});
