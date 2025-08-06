import { describe, expect, test } from "vitest";
import { CompositeType } from "../composite-type.model.ts";
import { DropCompositeType } from "./composite-type.drop.ts";

describe("composite-type", () => {
  test("drop", () => {
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

    const change = new DropCompositeType({
      compositeType,
    });

    expect(change.serialize()).toBe("DROP TYPE public.test_type");
  });
});
