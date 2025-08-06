import { describe, expect, test } from "vitest";
import { View } from "../view.model.ts";
import { DropView } from "./view.drop.ts";

describe("view", () => {
  test("drop", () => {
    const view = new View({
      schema: "public",
      name: "test_view",
      definition: "SELECT * FROM test_table",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "test",
    });

    const change = new DropView({
      view,
    });

    expect(change.serialize()).toBe("DROP VIEW public.test_view");
  });
});
