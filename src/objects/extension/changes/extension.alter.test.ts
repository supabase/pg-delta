import { describe, expect, test } from "vitest";
import { Extension } from "../extension.model.ts";
import {
  AlterExtensionChangeOwner,
  AlterExtensionSetSchema,
  AlterExtensionUpdateVersion,
  ReplaceExtension,
} from "./extension.alter.ts";

describe.concurrent("extension", () => {
  describe("alter", () => {
    test("update version", () => {
      const main = new Extension({
        name: "test_extension",
        schema: "public",
        relocatable: true,
        version: "1.0",
        owner: "test",
      });
      const branch = new Extension({
        name: "test_extension",
        schema: "public",
        relocatable: true,
        version: "2.0",
        owner: "test",
      });

      const change = new AlterExtensionUpdateVersion({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER EXTENSION test_extension UPDATE TO 2.0",
      );
    });

    test("set schema", () => {
      const main = new Extension({
        name: "test_extension",
        schema: "public",
        relocatable: true,
        version: "1.0",
        owner: "test",
      });
      const branch = new Extension({
        name: "test_extension",
        schema: "extensions",
        relocatable: true,
        version: "1.0",
        owner: "test",
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
      const main = new Extension({
        name: "test_extension",
        schema: "public",
        relocatable: true,
        version: "1.0",
        owner: "old_owner",
      });
      const branch = new Extension({
        name: "test_extension",
        schema: "public",
        relocatable: true,
        version: "1.0",
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
      const main = new Extension({
        name: "test_extension",
        schema: "public",
        relocatable: false,
        version: "1.0",
        owner: "test",
      });
      const branch = new Extension({
        name: "test_extension",
        schema: "public",
        relocatable: true,
        version: "1.0",
        owner: "test",
      });

      const change = new ReplaceExtension({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP EXTENSION test_extension;\nCREATE EXTENSION test_extension SCHEMA public VERSION 1.0",
      );
    });
  });
});
