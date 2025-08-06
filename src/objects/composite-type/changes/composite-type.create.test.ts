import { describe, expect, test } from "vitest";
import { CompositeType } from "../composite-type.model.ts";
import { CreateCompositeType } from "./composite-type.create.ts";

describe("composite-type", () => {
  test("create", () => {
    const compositeType = new CompositeType({
      schema: "public",
      name: "test_type",
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

    const change = new CreateCompositeType({
      compositeType,
    });

    expect(change.serialize()).toBe("CREATE TYPE public . test_type AS ()");
  });
});
