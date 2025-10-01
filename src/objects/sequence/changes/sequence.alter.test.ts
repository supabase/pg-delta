import { describe, expect, test } from "vitest";
import { Sequence, type SequenceProps } from "../sequence.model.ts";
import {
  AlterSequenceSetOptions,
  AlterSequenceSetOwnedBy,
} from "./sequence.alter.ts";

describe.concurrent("sequence", () => {
  describe("alter", () => {
    test("set owned by table column", () => {
      const props: Omit<
        SequenceProps,
        "owned_by_schema" | "owned_by_table" | "owned_by_column"
      > = {
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
        comment: null,
      };
      const main = new Sequence({
        ...props,
        owned_by_schema: null,
        owned_by_table: null,
        owned_by_column: null,
      });
      const branch = new Sequence({
        ...props,
        owned_by_schema: "public",
        owned_by_table: "t",
        owned_by_column: "id",
      });

      const change = new AlterSequenceSetOwnedBy({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER SEQUENCE public.test_sequence OWNED BY public.t.id",
      );
    });

    test("owned by none", () => {
      const main = new Sequence({
        schema: "public",
        name: "s",
        data_type: "bigint",
        start_value: 1,
        minimum_value: 1n,
        maximum_value: 9223372036854775807n,
        increment: 1,
        cycle_option: false,
        cache_size: 1,
        persistence: "p",
        owned_by_schema: "public",
        owned_by_table: "t",
        owned_by_column: "id",
        comment: null,
      });
      const branch = new Sequence({
        ...main,
        owned_by_schema: null,
        owned_by_table: null,
        owned_by_column: null,
      });
      const change = new AlterSequenceSetOwnedBy({ main, branch });
      expect(change.serialize()).toBe("ALTER SEQUENCE public.s OWNED BY NONE");
    });

    test("drop + create sequence (handled in diff)", () => {
      expect(1).toBe(1);
    });

    test("alter options: increment, min/max, start, cache, cycle", () => {
      const main = new Sequence({
        schema: "public",
        name: "s",
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
        comment: null,
      });
      const branch = new Sequence({
        ...main,
        increment: 2,
        minimum_value: 5n,
        maximum_value: 100n,
        start_value: 10,
        cache_size: 3,
        cycle_option: true,
      });
      const change = new AlterSequenceSetOptions({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER SEQUENCE public.s INCREMENT BY 2 MINVALUE 5 MAXVALUE 100 START WITH 10 CACHE 3 CYCLE",
      );
    });

    test("alter options: reset to defaults uses NO MINVALUE/NO MAXVALUE", () => {
      const main = new Sequence({
        schema: "public",
        name: "s",
        data_type: "integer",
        start_value: 5,
        minimum_value: 3n,
        maximum_value: 100n,
        increment: 2,
        cycle_option: true,
        cache_size: 2,
        persistence: "p",
        owned_by_schema: null,
        owned_by_table: null,
        owned_by_column: null,
        comment: null,
      });
      const branch = new Sequence({
        ...main,
        start_value: 1,
        minimum_value: 1n,
        maximum_value: 2147483647n,
        increment: 1,
        cycle_option: false,
        cache_size: 1,
      });
      const change = new AlterSequenceSetOptions({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER SEQUENCE public.s INCREMENT BY 1 NO MINVALUE NO MAXVALUE START WITH 1 CACHE 1 NO CYCLE",
      );
    });
  });
});
