import { describe, expect, test } from "bun:test";
import {
  createObjectRef,
  isBuiltInObjectRef,
  normalizeIdentifier,
  normalizeSignature,
  splitQualifiedName,
} from "../src/model/object-ref";

describe("object reference normalization", () => {
  test("folds unquoted identifiers while preserving quoted identifiers", () => {
    expect(normalizeIdentifier("Public")).toBe("public");
    expect(normalizeIdentifier('"Users"')).toBe("Users");
  });

  test("splits qualified names with quoted segments", () => {
    const quoted = splitQualifiedName('"App"."Users"');
    const unquoted = splitQualifiedName("App.Users");

    expect(quoted).toEqual({ schema: "App", name: "Users" });
    expect(unquoted).toEqual({ schema: "app", name: "users" });
  });

  test("normalizes function signatures deterministically", () => {
    expect(normalizeSignature("( INT , text , numeric(10, 2) )")).toBe(
      "(int,text,numeric(10,2))",
    );
    expect(normalizeSignature('("CustomType" , public.USER_ROLE )')).toBe(
      '("CustomType",public.user_role)',
    );
  });

  test("createObjectRef normalizes schema/name/signature", () => {
    const ref = createObjectRef("function", "Fn_A", "Public", "( INT , text )");

    expect(ref.schema).toBe("public");
    expect(ref.name).toBe("fn_a");
    expect(ref.signature).toBe("(int,text)");
  });

  test("isBuiltInObjectRef treats common pg_catalog types as built-in", () => {
    expect(isBuiltInObjectRef({ kind: "type", name: "inet" })).toBe(true);
    expect(
      isBuiltInObjectRef({ kind: "type", name: "name", schema: "public" }),
    ).toBe(true);
    expect(isBuiltInObjectRef({ kind: "type", name: "event_trigger" })).toBe(
      true,
    );
    expect(isBuiltInObjectRef({ kind: "type", name: "oid" })).toBe(true);
    expect(isBuiltInObjectRef({ kind: "type", name: "regclass" })).toBe(true);
    expect(isBuiltInObjectRef({ kind: "type", name: "custom_type" })).toBe(
      false,
    );
  });

  test("isBuiltInObjectRef treats polymorphic pseudo-types as built-ins", () => {
    for (const name of [
      "anycompatible",
      "anycompatiblearray",
      "anycompatiblenonarray",
      "anycompatiblerange",
      "anycompatiblemultirange",
      "anynonarray",
    ]) {
      expect(isBuiltInObjectRef({ kind: "type", name })).toBe(true);
    }
  });

  test("isBuiltInObjectRef preserves schema-qualified arrays that shadow built-ins", () => {
    expect(isBuiltInObjectRef({ kind: "type", name: "int4[]" })).toBe(true);
    expect(
      isBuiltInObjectRef({
        kind: "type",
        schema: "pg_catalog",
        name: "int4[]",
      }),
    ).toBe(true);
    expect(
      isBuiltInObjectRef({ kind: "type", schema: "app", name: "int4[]" }),
    ).toBe(false);
  });
});
