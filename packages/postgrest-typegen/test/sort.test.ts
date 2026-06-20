import { describe, expect, test } from "bun:test";

import { sortGeneratorMetadata } from "../src/sort.ts";
import {
  baseColumn,
  baseFunction,
  baseRelationship,
  baseTable,
  baseView,
  buildMetadata,
} from "./generation/fixtures.ts";

describe("sortGeneratorMetadata", () => {
  test("orders by semantic keys (schema/name), NOT by oid", () => {
    // ids deliberately disagree with names so the assertions prove the sort is
    // name-based — an oid sort would yield a different order, and oids are not
    // stable across equivalent databases.
    const shuffled = buildMetadata({
      tables: [
        baseTable({ id: 3, name: "a" }),
        baseTable({ id: 1, name: "b" }),
        baseTable({ id: 2, name: "c" }),
      ],
      views: [
        baseView({ id: 9, name: "v_a" }),
        baseView({ id: 5, name: "v_b" }),
      ],
      functions: [
        baseFunction({ id: 20, name: "f_a" }),
        baseFunction({ id: 10, name: "f_b" }),
      ],
      columns: [
        baseColumn({ table_id: 1, table: "b", ordinal_position: 1, name: "x" }),
        baseColumn({ table_id: 3, table: "a", ordinal_position: 2, name: "y" }),
        baseColumn({ table_id: 3, table: "a", ordinal_position: 1, name: "z" }),
      ],
    });

    const result = sortGeneratorMetadata(shuffled);
    expect(result.tables.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(result.tables.map((t) => t.id)).toEqual([3, 1, 2]);
    expect(result.views.map((v) => v.name)).toEqual(["v_a", "v_b"]);
    expect(result.functions.map((f) => f.name)).toEqual(["f_a", "f_b"]);
    // Columns grouped by (schema, table) with ordinal order preserved within.
    expect(result.columns.map((c) => [c.table, c.ordinal_position])).toEqual([
      ["a", 1],
      ["a", 2],
      ["b", 1],
    ]);
  });

  test("disambiguates overloaded functions by signature", () => {
    const result = sortGeneratorMetadata(
      buildMetadata({
        functions: [
          baseFunction({ id: 2, name: "f", identity_argument_types: "text" }),
          baseFunction({
            id: 1,
            name: "f",
            identity_argument_types: "integer",
          }),
        ],
      }),
    );
    expect(result.functions.map((f) => f.identity_argument_types)).toEqual([
      "integer",
      "text",
    ]);
  });

  test("is idempotent", () => {
    const sorted = sortGeneratorMetadata(
      buildMetadata({
        tables: [
          baseTable({ id: 2, name: "a" }),
          baseTable({ id: 1, name: "b" }),
        ],
        relationships: [baseRelationship()],
      }),
    );
    expect(sortGeneratorMetadata(sorted)).toEqual(sorted);
  });

  test("does not mutate the input", () => {
    const input = buildMetadata({
      tables: [
        baseTable({ id: 1, name: "b" }),
        baseTable({ id: 2, name: "a" }),
      ],
    });
    const before = input.tables.map((t) => t.name);
    sortGeneratorMetadata(input);
    expect(input.tables.map((t) => t.name)).toEqual(before);
  });

  test("preserves the order of nested, semantically-ordered arrays", () => {
    // Function arg order is meaningful and must NOT be touched.
    const args = [
      { mode: "in" as const, name: "z", type_id: 23, has_default: false },
      { mode: "in" as const, name: "a", type_id: 23, has_default: false },
    ];
    const result = sortGeneratorMetadata(
      buildMetadata({ functions: [baseFunction({ id: 1, name: "f", args })] }),
    );
    expect(result.functions[0].args.map((a) => a.name)).toEqual(["z", "a"]);
  });
});
