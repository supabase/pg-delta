import { describe, expect, test } from "vitest";
import { Sequence } from "../sequence.model.ts";
import { AlterSequenceChangeOwner, ReplaceSequence } from "./sequence.alter.ts";

describe.concurrent("sequence", () => {
  describe("alter", () => {
    test("change owner", () => {
      const main = new Sequence({
        schema: "public",
        name: "test_sequence",
        data_type: "integer",
        start_value: 1,
        minimum_value: 1,
        maximum_value: 2147483647,
        increment: 1,
        cycle_option: false,
        cache_size: 1,
        persistence: "p",
        owner: "old_owner",
      });
      const branch = new Sequence({
        schema: "public",
        name: "test_sequence",
        data_type: "integer",
        start_value: 1,
        minimum_value: 1,
        maximum_value: 2147483647,
        increment: 1,
        cycle_option: false,
        cache_size: 1,
        persistence: "p",
        owner: "new_owner",
      });

      const change = new AlterSequenceChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER SEQUENCE public.test_sequence OWNER TO new_owner",
      );
    });

    test("replace sequence", () => {
      const main = new Sequence({
        schema: "public",
        name: "test_sequence",
        data_type: "integer",
        start_value: 1,
        minimum_value: 1,
        maximum_value: 2147483647,
        increment: 1,
        cycle_option: false,
        cache_size: 1,
        persistence: "p",
        owner: "test",
      });
      const branch = new Sequence({
        schema: "public",
        name: "test_sequence",
        data_type: "bigint",
        start_value: 1,
        minimum_value: 1,
        maximum_value: 9223372036854775807n,
        increment: 1,
        cycle_option: false,
        cache_size: 1,
        persistence: "p",
        owner: "test",
      });

      const change = new ReplaceSequence({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP SEQUENCE public.test_sequence;\nCREATE SEQUENCE public.test_sequence AS bigint",
      );
    });
  });
});
