import { describe, expect, test } from "vitest";
import { Extension } from "../extension.model.ts";
import { CreateExtension } from "./extension.create.ts";

describe("extension", () => {
  test("create", () => {
    const extension = new Extension({
      name: "test_extension",
      schema: "public",
      relocatable: true,
      version: "1.0",
      owner: "test",
      comment: null,
      members: [],
    });

    const change = new CreateExtension({
      extension,
    });

    expect(change.serialize()).toBe(
      `CREATE EXTENSION test_extension WITH SCHEMA public`,
    );
  });
});
