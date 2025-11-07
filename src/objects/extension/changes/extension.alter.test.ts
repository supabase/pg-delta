import { describe, expect, test } from "vitest";
import { Extension, type ExtensionProps } from "../extension.model.ts";
import {
  AlterExtensionSetSchema,
  AlterExtensionUpdateVersion,
} from "./extension.alter.ts";

describe.concurrent("extension", () => {
  describe("alter", () => {
    test("update version", () => {
      const props: Omit<ExtensionProps, "version"> = {
        name: "test_extension",
        schema: "public",
        relocatable: true,
        owner: "test",
        comment: null,
        members: [],
      };
      const extension = new Extension({
        ...props,
        version: "1.0",
      });

      const change = new AlterExtensionUpdateVersion({
        extension,
        version: "2.0",
      });

      expect(change.serialize()).toBe(
        "ALTER EXTENSION test_extension UPDATE TO '2.0'",
      );
    });

    test("set schema", () => {
      const props: Omit<ExtensionProps, "schema"> = {
        name: "test_extension",
        relocatable: true,
        version: "1.0",
        owner: "test",
        comment: null,
        members: [],
      };
      const extension = new Extension({
        ...props,
        schema: "public",
      });

      const change = new AlterExtensionSetSchema({
        extension,
        schema: "extensions",
      });

      expect(change.serialize()).toBe(
        "ALTER EXTENSION test_extension SET SCHEMA extensions",
      );
    });
  });
});
