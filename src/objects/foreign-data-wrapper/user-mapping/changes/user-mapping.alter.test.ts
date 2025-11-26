import { describe, expect, test } from "vitest";
import { UserMapping, type UserMappingProps } from "../user-mapping.model.ts";
import { AlterUserMappingSetOptions } from "./user-mapping.alter.ts";

describe.concurrent("user-mapping", () => {
  describe("alter", () => {
    test("set options ADD", () => {
      const props: UserMappingProps = {
        user: "test_user",
        server: "test_server",
        options: null,
      };
      const userMapping = new UserMapping(props);
      const change = new AlterUserMappingSetOptions({
        userMapping,
        options: [
          { action: "ADD", option: "user", value: "remote_user" },
          { action: "ADD", option: "password", value: "secret" },
        ],
      });

      expect(change.serialize()).toBe(
        "-- WARNING: User mapping options contain values (user, password)\n-- Replace placeholders below with actual values\nALTER USER MAPPING FOR test_user SERVER test_server OPTIONS (ADD user '__OPTION_USER__', ADD password '__OPTION_PASSWORD__')",
      );
    });

    test("set options SET", () => {
      const props: UserMappingProps = {
        user: "test_user",
        server: "test_server",
        options: null,
      };
      const userMapping = new UserMapping(props);
      const change = new AlterUserMappingSetOptions({
        userMapping,
        options: [{ action: "SET", option: "password", value: "new_secret" }],
      });

      expect(change.serialize()).toBe(
        "-- WARNING: User mapping options contain values (password)\n-- Replace placeholders below with actual values\nALTER USER MAPPING FOR test_user SERVER test_server OPTIONS (SET password '__OPTION_PASSWORD__')",
      );
    });

    test("set options DROP", () => {
      const props: UserMappingProps = {
        user: "test_user",
        server: "test_server",
        options: null,
      };
      const userMapping = new UserMapping(props);
      const change = new AlterUserMappingSetOptions({
        userMapping,
        options: [{ action: "DROP", option: "password" }],
      });

      expect(change.serialize()).toBe(
        "ALTER USER MAPPING FOR test_user SERVER test_server OPTIONS (DROP password)",
      );
    });

    test("set options mixed ADD/SET/DROP", () => {
      const props: UserMappingProps = {
        user: "PUBLIC",
        server: "test_server",
        options: null,
      };
      const userMapping = new UserMapping(props);
      const change = new AlterUserMappingSetOptions({
        userMapping,
        options: [
          { action: "ADD", option: "new_option", value: "new_value" },
          { action: "SET", option: "existing_option", value: "updated_value" },
          { action: "DROP", option: "old_option" },
        ],
      });

      expect(change.serialize()).toBe(
        "-- WARNING: User mapping options contain values (new_option, existing_option)\n-- Replace placeholders below with actual values\nALTER USER MAPPING FOR PUBLIC SERVER test_server OPTIONS (ADD new_option '__OPTION_NEW_OPTION__', SET existing_option '__OPTION_EXISTING_OPTION__', DROP old_option)",
      );
    });
  });
});
