import { describe, expect, test } from "bun:test";

import { sortGeneratorMetadata } from "../src/sort.ts";
import type { GeneratorMetadata } from "../src/types.ts";
import {
  baseColumn,
  baseFunction,
  baseRelationship,
  baseTable,
  baseView,
  buildMetadata,
} from "./generation/fixtures.ts";

/**
 * Unshuffled reference: collections in their canonical (sorted) order. The
 * tests below shuffle this and assert `sortGeneratorMetadata` restores it.
 */
const sorted = (): GeneratorMetadata =>
  buildMetadata({
    tables: [
      baseTable({ id: 1, name: "a" }),
      baseTable({ id: 2, name: "b" }),
      baseTable({ id: 3, name: "c" }),
    ],
    views: [baseView({ id: 5, name: "v1" }), baseView({ id: 9, name: "v2" })],
    columns: [
      baseColumn({ table_id: 1, ordinal_position: 1, name: "id" }),
      baseColumn({ table_id: 1, ordinal_position: 2, name: "aaa" }),
      baseColumn({ table_id: 2, ordinal_position: 1, name: "zzz" }),
    ],
    functions: [
      baseFunction({ id: 10, name: "f_a" }),
      baseFunction({ id: 20, name: "f_b" }),
    ],
    relationships: [baseRelationship()],
  });

describe("sortGeneratorMetadata", () => {
  test("orders tables/views/functions by id and columns by (table_id, ordinal_position)", () => {
    const shuffled: GeneratorMetadata = {
      ...sorted(),
      tables: [
        baseTable({ id: 3, name: "c" }),
        baseTable({ id: 1, name: "a" }),
        baseTable({ id: 2, name: "b" }),
      ],
      views: [baseView({ id: 9, name: "v2" }), baseView({ id: 5, name: "v1" })],
      columns: [
        baseColumn({ table_id: 2, ordinal_position: 1, name: "zzz" }),
        baseColumn({ table_id: 1, ordinal_position: 2, name: "aaa" }),
        baseColumn({ table_id: 1, ordinal_position: 1, name: "id" }),
      ],
      functions: [
        baseFunction({ id: 20, name: "f_b" }),
        baseFunction({ id: 10, name: "f_a" }),
      ],
    };

    const result = sortGeneratorMetadata(shuffled);
    expect(result.tables.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(result.views.map((v) => v.id)).toEqual([5, 9]);
    expect(result.functions.map((f) => f.id)).toEqual([10, 20]);
    expect(result.columns.map((c) => [c.table_id, c.ordinal_position])).toEqual(
      [
        [1, 1],
        [1, 2],
        [2, 1],
      ],
    );
  });

  test("is idempotent", () => {
    const once = sortGeneratorMetadata(sorted());
    const twice = sortGeneratorMetadata(once);
    expect(twice).toEqual(once);
  });

  test("does not mutate the input", () => {
    const input = sortGeneratorMetadata(sorted()); // canonical
    const reversed: GeneratorMetadata = {
      ...input,
      tables: [...input.tables].reverse(),
    };
    const snapshotIds = reversed.tables.map((t) => t.id);
    sortGeneratorMetadata(reversed);
    expect(reversed.tables.map((t) => t.id)).toEqual(snapshotIds);
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
