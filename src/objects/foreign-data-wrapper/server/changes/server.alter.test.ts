import { describe, expect, test } from "vitest";
import { Server, type ServerProps } from "../server.model.ts";
import {
  AlterServerChangeOwner,
  AlterServerSetOptions,
  AlterServerSetVersion,
} from "./server.alter.ts";

describe.concurrent("server", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "old_owner",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerChangeOwner({
        server,
        owner: "new_owner",
      });

      expect(change.serialize()).toBe(
        "ALTER SERVER test_server OWNER TO new_owner",
      );
    });

    test("set version", () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetVersion({
        server,
        version: "2.0",
      });

      expect(change.serialize()).toBe("ALTER SERVER test_server VERSION '2.0'");
    });

    test("set version to null", () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: "1.0",
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetVersion({
        server,
        version: null,
      });

      expect(change.serialize()).toBe("ALTER SERVER test_server VERSION ''");
    });

    test("set options ADD", () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetOptions({
        server,
        options: [
          { action: "ADD", option: "host", value: "localhost" },
          { action: "ADD", option: "port", value: "5432" },
        ],
      });

      expect(change.serialize()).toBe(
        "-- WARNING: Server options contain values (host, port)\n-- Replace placeholders below with actual values\nALTER SERVER test_server OPTIONS (ADD host '__OPTION_HOST__', ADD port '__OPTION_PORT__')",
      );
    });

    test("set options SET", () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetOptions({
        server,
        options: [{ action: "SET", option: "host", value: "newhost" }],
      });

      expect(change.serialize()).toBe(
        "-- WARNING: Server options contain values (host)\n-- Replace placeholders below with actual values\nALTER SERVER test_server OPTIONS (SET host '__OPTION_HOST__')",
      );
    });

    test("set options DROP", () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetOptions({
        server,
        options: [{ action: "DROP", option: "host" }],
      });

      expect(change.serialize()).toBe(
        "ALTER SERVER test_server OPTIONS (DROP host)",
      );
    });

    test("set options mixed ADD/SET/DROP", () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetOptions({
        server,
        options: [
          { action: "ADD", option: "new_option", value: "new_value" },
          { action: "SET", option: "existing_option", value: "updated_value" },
          { action: "DROP", option: "old_option" },
        ],
      });

      expect(change.serialize()).toBe(
        "-- WARNING: Server options contain values (new_option, existing_option)\n-- Replace placeholders below with actual values\nALTER SERVER test_server OPTIONS (ADD new_option '__OPTION_NEW_OPTION__', SET existing_option '__OPTION_EXISTING_OPTION__', DROP old_option)",
      );
    });
  });
});
