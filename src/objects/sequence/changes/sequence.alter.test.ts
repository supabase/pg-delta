import { describe, expect, test } from "vitest";
import { Sequence, type SequenceProps } from "../sequence.model.ts";
import { AlterSequenceChangeOwner, ReplaceSequence } from "./sequence.alter.ts";

describe.concurrent("sequence", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<SequenceProps, "owner"> = {
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
      };
      const main = new Sequence({
        ...props,
        owner: "old_owner",
      });
      const branch = new Sequence({
        ...props,
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
      const props: Omit<SequenceProps, "data_type" | "maximum_value"> = {
        schema: "public",
        name: "test_sequence",
        start_value: 1,
        minimum_value: 1n,
        increment: 1,
        cycle_option: false,
        cache_size: 1,
        persistence: "p",
        owner: "test",
      };
      const main = new Sequence({
        ...props,
        data_type: "integer",
        maximum_value: 2147483647n,
      });
      const branch = new Sequence({
        ...props,
        data_type: "bigint",
        maximum_value: 9223372036854775807n,
      });

      const change = new ReplaceSequence({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP SEQUENCE public.test_sequence;\nCREATE SEQUENCE public.test_sequence",
      );
    });
  });
});
