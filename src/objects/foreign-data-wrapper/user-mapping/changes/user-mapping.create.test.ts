import { describe, expect, test } from "vitest";
import { UserMapping } from "../user-mapping.model.ts";
import { CreateUserMapping } from "./user-mapping.create.ts";

describe("user-mapping", () => {
  test("create basic", () => {
    const userMapping = new UserMapping({
      user: "test_user",
      server: "test_server",
      options: null,
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    expect(change.serialize()).toBe(
      "CREATE USER MAPPING FOR test_user SERVER test_server",
    );
  });

  test("create with PUBLIC user", () => {
    const userMapping = new UserMapping({
      user: "PUBLIC",
      server: "test_server",
      options: null,
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    expect(change.serialize()).toBe(
      "CREATE USER MAPPING FOR PUBLIC SERVER test_server",
    );
  });

  test("create with CURRENT_USER", () => {
    const userMapping = new UserMapping({
      user: "CURRENT_USER",
      server: "test_server",
      options: null,
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    expect(change.serialize()).toBe(
      "CREATE USER MAPPING FOR CURRENT_USER SERVER test_server",
    );
  });

  test("create with options", () => {
    const userMapping = new UserMapping({
      user: "test_user",
      server: "test_server",
      options: ["user", "remote_user", "password", "secret"],
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    expect(change.serialize()).toBe(
      "CREATE USER MAPPING FOR test_user SERVER test_server OPTIONS (user 'remote_user', password 'secret')",
    );
  });

  test("create with all properties", () => {
    const userMapping = new UserMapping({
      user: "PUBLIC",
      server: "test_server",
      options: ["user", "remote_user", "password", "secret"],
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    expect(change.serialize()).toBe(
      "CREATE USER MAPPING FOR PUBLIC SERVER test_server OPTIONS (user 'remote_user', password 'secret')",
    );
  });
});
