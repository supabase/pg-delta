import { describe, expect, test } from "vitest";
import { View } from "../view.model.ts";
import { CreateView } from "./view.create.ts";

describe("view", () => {
  test("create", () => {
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

    const change = new CreateView({
      view,
    });

    expect(change.serialize()).toBe(
      "CREATE OR REPLACE VIEW public.test_view AS SELECT * FROM test_table",
    );
  });
});
