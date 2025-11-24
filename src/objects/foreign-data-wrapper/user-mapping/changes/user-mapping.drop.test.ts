import { describe, expect, test } from "vitest";
import { UserMapping } from "../user-mapping.model.ts";
import { DropUserMapping } from "./user-mapping.drop.ts";

describe("user-mapping", () => {
  test("drop", () => {
    const userMapping = new UserMapping({
      user: "test_user",
      server: "test_server",
      options: null,
    });

    const change = new DropUserMapping({
      userMapping,
    });

    expect(change.serialize()).toBe(
      "DROP USER MAPPING FOR test_user SERVER test_server",
    );
  });

  test("drop PUBLIC user mapping", () => {
    const userMapping = new UserMapping({
      user: "PUBLIC",
      server: "test_server",
      options: null,
    });

    const change = new DropUserMapping({
      userMapping,
    });

    expect(change.serialize()).toBe(
      "DROP USER MAPPING FOR PUBLIC SERVER test_server",
    );
  });

  test("drop CURRENT_USER mapping", () => {
    const userMapping = new UserMapping({
      user: "CURRENT_USER",
      server: "test_server",
      options: null,
    });

    const change = new DropUserMapping({
      userMapping,
    });

    expect(change.serialize()).toBe(
      "DROP USER MAPPING FOR CURRENT_USER SERVER test_server",
    );
  });
});
