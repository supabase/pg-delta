import { describe, expect, test } from "vitest";
import {
  AlterSequenceChangeOwner,
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
  owner: "o1",
};

describe.concurrent("sequence.diff", () => {
  test("create and drop", () => {
    const s = new Sequence(base);
    const created = diffSequences({}, { [s.stableId]: s });
    expect(created[0]).toBeInstanceOf(CreateSequence);
    const dropped = diffSequences({ [s.stableId]: s }, {});
    expect(dropped[0]).toBeInstanceOf(DropSequence);
  });

  test("alter owner", () => {
    const main = new Sequence(base);
    const branch = new Sequence({ ...base, owner: "o2" });
    const changes = diffSequences(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterSequenceChangeOwner);
  });

  test("replace on non-alterable change", () => {
    const main = new Sequence(base);
    const branch = new Sequence({ ...base, increment: 2 });
    const changes = diffSequences(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceSequence);
  });
});
