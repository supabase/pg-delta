import { describe, expect, test } from "vitest";
import { DefaultPrivilegeState } from "../base.default-privileges.ts";
import type { Table } from "../table/table.model.ts";
import {
  AlterSequenceSetOptions,
  AlterSequenceSetOwnedBy,
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
  comment: null,
  privileges: [],
  owner: "test",
};

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
};

describe.concurrent("sequence.diff", () => {
  test("create and drop", () => {
    const s = new Sequence(base);
    const created = diffSequences(testContext, {}, { [s.stableId]: s });
    expect(created[0]).toBeInstanceOf(CreateSequence);
    const dropped = diffSequences(testContext, { [s.stableId]: s }, {});
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
      testContext,
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
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterSequenceSetOptions)).toBe(
      true,
    );
  });

  test("drop and create when non-alterable property changes", () => {
    const main = new Sequence(base);
    const branch = new Sequence({
      ...base,
      data_type: "integer",
      persistence: "u",
    });
    const changes = diffSequences(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(DropSequence);
    expect(changes[1]).toBeInstanceOf(CreateSequence);
  });

  test("skip DROP SEQUENCE when owned by table being dropped", () => {
    const ownedSequence = new Sequence({
      ...base,
      owned_by_schema: "public",
      owned_by_table: "users",
      owned_by_column: "id",
    });
    // When the owning table is not in branch catalog (being dropped),
    // DROP SEQUENCE should not be generated (PostgreSQL auto-drops it)
    const changes = diffSequences(
      testContext,
      { [ownedSequence.stableId]: ownedSequence },
      {}, // branch has no sequences (sequence was auto-dropped)
      {}, // branch has no tables (table is being dropped)
    );
    // Should not generate DROP SEQUENCE since table is being dropped
    expect(changes).toHaveLength(0);
  });

  test("generate DROP SEQUENCE when owned by table that still exists", () => {
    const ownedSequence = new Sequence({
      ...base,
      owned_by_schema: "public",
      owned_by_table: "users",
      owned_by_column: "id",
    });
    // When the owning table still exists in branch catalog,
    // DROP SEQUENCE should be generated
    const changes = diffSequences(
      testContext,
      { [ownedSequence.stableId]: ownedSequence },
      {}, // branch has no sequences
      {
        "table:public.users": {} as Table, // table still exists
      },
    );
    // Should generate DROP SEQUENCE since table still exists
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(DropSequence);
  });
});
