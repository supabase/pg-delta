import { describe, expect, test } from "vitest";
import { Sequence } from "../sequence.model.ts";
import { DropSequence } from "./sequence.drop.ts";

describe("sequence", () => {
  test("drop", () => {
    const sequence = new Sequence({
      schema: "public",
      name: "test_sequence",
      data_type: "integer",
      start_value: 1,
      minimum_value: 1n,
      maximum_value: 2147483647n,
      increment: 1,
      cycle_option: false,
      cache_size: 1,
      persistence: "p",
      owned_by_schema: null,
      owned_by_table: null,
      owned_by_column: null,
    });

    const change = new DropSequence({
      sequence,
    });

    expect(change.serialize()).toBe("DROP SEQUENCE public.test_sequence");
  });
});
