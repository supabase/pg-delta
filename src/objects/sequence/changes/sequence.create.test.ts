import { describe, expect, test } from "vitest";
import { Sequence } from "../sequence.model.ts";
import { CreateSequence } from "./sequence.create.ts";

describe("sequence", () => {
  test("create", () => {
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
      owner: "test",
    });

    const change = new CreateSequence({
      sequence,
    });

    expect(change.serialize()).toBe(
      "CREATE SEQUENCE public.test_sequence AS integer",
    );
  });
});
