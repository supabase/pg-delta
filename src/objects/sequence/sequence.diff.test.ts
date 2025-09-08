import { describe, expect, test } from "vitest";
import {
  AlterSequenceSetOptions,
  AlterSequenceSetOwnedBy,
  ReplaceSequence,
} from "./changes/sequence.alter.ts";
import { CreateSequence } from "./changes/sequence.create.ts";
import { DropSequence } from "./changes/sequence.drop.ts";
import { diffSequences } from "./sequence.diff.ts";
import { Sequence, type SequenceProps } from "./sequence.model.ts";

const base: SequenceProps = {
  schema: "public",
  name: "seq1",
  data_type: "bigint",
  start_value: 1,
  minimum_value: 1n,
  maximum_value: 1000n,
  increment: 1,
  cycle_option: false,
  cache_size: 1,
  persistence: "p",
  owned_by_schema: null,
  owned_by_table: null,
  owned_by_column: null,
};

describe.concurrent("sequence.diff", () => {
  test("create and drop", () => {
    const s = new Sequence(base);
    const created = diffSequences({}, { [s.stableId]: s });
    expect(created[0]).toBeInstanceOf(CreateSequence);
    const dropped = diffSequences({ [s.stableId]: s }, {});
    expect(dropped[0]).toBeInstanceOf(DropSequence);
  });

  test("alter owned by", () => {
    const main = new Sequence(base);
    const branch = new Sequence({
      ...base,
      owned_by_schema: "public",
      owned_by_table: "t",
      owned_by_column: "id",
    });
    const changes = diffSequences(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterSequenceSetOwnedBy);
  });

  test("alter options via diff", () => {
    const main = new Sequence(base);
    const branch = new Sequence({
      ...base,
      increment: 2,
      minimum_value: 5n,
      maximum_value: 500n,
      start_value: 10,
      cache_size: 3,
      cycle_option: true,
    });
    const changes = diffSequences(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterSequenceSetOptions)).toBe(
      true,
    );
  });

  test("replace on non-alterable change", () => {
    const main = new Sequence(base);
    const branch = new Sequence({ ...base, data_type: "integer" });
    const changes = diffSequences(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceSequence);
  });
});
