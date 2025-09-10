import { describe, expect, test } from "vitest";
import { Sequence } from "../sequence.model.ts";
import { CreateSequence } from "./sequence.create.ts";

describe("sequence", () => {
  test("create minimal (all defaults elided)", () => {
    const sequence = new Sequence({
      schema: "public",
      name: "s_min",
      data_type: "bigint",
      start_value: 1,
      minimum_value: 1n,
      maximum_value: 9223372036854775807n,
      increment: 1,
      cycle_option: false,
      cache_size: 1,
      persistence: "p",
      owned_by_schema: null,
      owned_by_table: null,
      owned_by_column: null,
    });

    const change = new CreateSequence({ sequence });
    expect(change.serialize()).toBe("CREATE SEQUENCE public.s_min");
  });

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
      owned_by_schema: null,
      owned_by_table: null,
      owned_by_column: null,
    });

    const change = new CreateSequence({
      sequence,
    });

    expect(change.serialize()).toBe(
      "CREATE SEQUENCE public.test_sequence AS integer",
    );
  });

  test("create with all options", () => {
    const sequence = new Sequence({
      schema: "public",
      name: "s_all",
      data_type: "integer",
      start_value: 10,
      minimum_value: 5n,
      maximum_value: 100n,
      increment: 2,
      cycle_option: true,
      cache_size: 3,
      persistence: "p",
      owned_by_schema: null,
      owned_by_table: null,
      owned_by_column: null,
    });

    const change = new CreateSequence({ sequence });
    expect(change.serialize()).toBe(
      "CREATE SEQUENCE public.s_all AS integer INCREMENT BY 2 MINVALUE 5 MAXVALUE 100 START WITH 10 CACHE 3 CYCLE",
    );
  });
});
