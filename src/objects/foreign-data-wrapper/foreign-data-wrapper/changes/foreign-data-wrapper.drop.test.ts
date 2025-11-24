import { describe, expect, test } from "vitest";
import { ForeignDataWrapper } from "../foreign-data-wrapper.model.ts";
import { DropForeignDataWrapper } from "./foreign-data-wrapper.drop.ts";

describe("foreign-data-wrapper", () => {
  test("drop", () => {
    const fdw = new ForeignDataWrapper({
      name: "test_fdw",
      owner: "test",
      handler: null,
      validator: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new DropForeignDataWrapper({
      foreignDataWrapper: fdw,
    });

    expect(change.serialize()).toBe("DROP FOREIGN DATA WRAPPER test_fdw");
  });
});
