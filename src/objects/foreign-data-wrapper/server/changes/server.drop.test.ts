import { describe, expect, test } from "vitest";
import { Server } from "../server.model.ts";
import { DropServer } from "./server.drop.ts";

describe("server", () => {
  test("drop", () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: null,
      version: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new DropServer({
      server,
    });

    expect(change.serialize()).toBe("DROP SERVER test_server");
  });
});
