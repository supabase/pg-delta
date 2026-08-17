import { describe, expect, test } from "bun:test";
import { isNonTransactional, sqlStateOf } from "./errors.ts";

describe("isNonTransactional", () => {
  test("detects SQLSTATE 25001", () => {
    expect(isNonTransactional({ code: "25001", message: "nope" })).toBe(true);
    expect(sqlStateOf({ code: "25001" })).toBe("25001");
  });

  test("detects the cannot-run-inside-a-transaction message", () => {
    expect(
      isNonTransactional(
        new Error("VACUUM cannot run inside a transaction block"),
      ),
    ).toBe(true);
  });

  test("ignores unrelated errors", () => {
    expect(isNonTransactional({ code: "42P01", message: "missing" })).toBe(
      false,
    );
    expect(isNonTransactional(new Error("syntax error"))).toBe(false);
    expect(isNonTransactional("string")).toBe(false);
  });
});
