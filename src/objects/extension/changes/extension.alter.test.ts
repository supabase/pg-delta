import { describe, expect, test } from "vitest";
import { Extension, type ExtensionProps } from "../extension.model.ts";
import {
  AlterExtensionChangeOwner,
  AlterExtensionSetSchema,
  AlterExtensionUpdateVersion,
  ReplaceExtension,
} from "./extension.alter.ts";

describe.concurrent("extension", () => {
  describe("alter", () => {
    test("update version", () => {
      const props: Omit<ExtensionProps, "version"> = {
        name: "test_extension",
        schema: "public",
        relocatable: true,
        owner: "test",
      };
      const main = new Extension({
        ...props,
        version: "1.0",
      });
      const branch = new Extension({
        ...props,
        version: "2.0",
      });

      const change = new AlterExtensionUpdateVersion({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        'ALTER EXTENSION test_extension UPDATE TO "2.0"',
      );
    });

    test("set schema", () => {
      const props: Omit<ExtensionProps, "schema"> = {
        name: "test_extension",
        relocatable: true,
        version: "1.0",
        owner: "test",
      };
      const main = new Extension({
        ...props,
        schema: "public",
      });
      const branch = new Extension({
        ...props,
        schema: "extensions",
      });

      const change = new AlterExtensionSetSchema({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER EXTENSION test_extension SET SCHEMA extensions",
      );
    });

    test("change owner", () => {
      const props: Omit<ExtensionProps, "owner"> = {
        name: "test_extension",
        schema: "public",
        relocatable: true,
        version: "1.0",
      };
      const main = new Extension({
        ...props,
        owner: "old_owner",
      });
      const branch = new Extension({
        ...props,
        owner: "new_owner",
      });

      const change = new AlterExtensionChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER EXTENSION test_extension OWNER TO new_owner",
      );
    });

    test("replace extension", () => {
      const props: Omit<ExtensionProps, "relocatable"> = {
        name: "test_extension",
        schema: "public",
        version: "1.0",
        owner: "test",
      };
      const main = new Extension({
        ...props,
        relocatable: false,
      });
      const branch = new Extension({
        ...props,
        relocatable: true,
      });

      const change = new ReplaceExtension({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        'DROP EXTENSION test_extension;\nCREATE EXTENSION test_extension WITH SCHEMA public VERSION "1.0"',
      );
    });
  });
});
