import { describe, expect, test } from "vitest";
import { MaterializedView } from "../materialized-view.model.ts";
import { DropMaterializedView } from "./materialized-view.drop.ts";

describe("materialized-view", () => {
  test("drop", () => {
    const materializedView = new MaterializedView({
      schema: "public",
      name: "test_mv",
      definition: "SELECT * FROM test_table",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "test",
    });

    const change = new DropMaterializedView({
      materializedView,
    });

    expect(change.serialize()).toBe("DROP MATERIALIZED VIEW public.test_mv");
  });
});
