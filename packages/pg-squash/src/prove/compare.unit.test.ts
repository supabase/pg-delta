import { describe, expect, test } from "bun:test";
import type { LedgerDiff } from "../shadow/index.ts";
import { compareProofStates } from "./index.ts";
import type { CapturedState, TableProofInput } from "./index.ts";

const emptyLedger = (): LedgerDiff => ({
  createdRoles: [],
  droppedRoles: [],
  addedMemberships: [],
  removedMemberships: [],
  addedSettings: [],
  removedSettings: [],
});

const captured = (overrides: Partial<CapturedState> = {}): CapturedState => ({
  rootHash: "hash-a",
  ledger: emptyLedger(),
  tables: [],
  ...overrides,
});

const table = (
  schema: string,
  name: string,
  rows: number,
  extras: Partial<Omit<TableProofInput, "schema" | "name" | "rows">> = {},
): TableProofInput => ({
  schema,
  name,
  rows,
  schemaSig: extras.schemaSig ?? "sig",
  ...(extras.content !== undefined ? { content: extras.content } : {}),
});

describe("compareProofStates", () => {
  test("matching hashes, empty ledgers, and empty tables are equal", () => {
    const original = captured();
    const candidate = captured();
    const proof = compareProofStates(original, candidate);
    expect(proof.equal).toBe(true);
    expect(proof.ledgerEqual).toBe(true);
    expect(proof.originalRootHash).toBe("hash-a");
    expect(proof.candidateRootHash).toBe("hash-a");
    expect(proof.tables).toEqual([]);
  });

  test("hash mismatch is not equal", () => {
    const proof = compareProofStates(
      captured({ rootHash: "hash-a" }),
      captured({ rootHash: "hash-b" }),
    );
    expect(proof.equal).toBe(false);
    expect(proof.ledgerEqual).toBe(true);
    expect(proof.originalRootHash).toBe("hash-a");
    expect(proof.candidateRootHash).toBe("hash-b");
  });

  test("createdRoles mismatch makes ledgerEqual and equal false", () => {
    const proof = compareProofStates(
      captured({
        ledger: { ...emptyLedger(), createdRoles: ["app"] },
      }),
      captured({
        ledger: { ...emptyLedger(), createdRoles: ["other"] },
      }),
    );
    expect(proof.ledgerEqual).toBe(false);
    expect(proof.equal).toBe(false);
  });

  test("ledger comparison is order-independent", () => {
    const proof = compareProofStates(
      captured({
        ledger: {
          ...emptyLedger(),
          createdRoles: ["b", "a"],
          addedMemberships: [
            { role: "r2", member: "m2", adminOption: false },
            { role: "r1", member: "m1", adminOption: true },
          ],
        },
      }),
      captured({
        ledger: {
          ...emptyLedger(),
          createdRoles: ["a", "b"],
          addedMemberships: [
            { role: "r1", member: "m1", adminOption: true },
            { role: "r2", member: "m2", adminOption: false },
          ],
        },
      }),
    );
    expect(proof.ledgerEqual).toBe(true);
    expect(proof.equal).toBe(true);
  });

  test("same table fingerprint match is coverage fingerprint and equal", () => {
    const tables = [table("public", "users", 2, { content: "fp-1" })];
    const proof = compareProofStates(
      captured({ tables }),
      captured({ tables: [table("public", "users", 2, { content: "fp-1" })] }),
    );
    expect(proof.equal).toBe(true);
    expect(proof.tables).toHaveLength(1);
    expect(proof.tables[0]?.coverage).toBe("fingerprint");
    expect(proof.tables[0]?.originalContent).toBe("fp-1");
    expect(proof.tables[0]?.candidateContent).toBe("fp-1");
  });

  test("fingerprint mismatch is not equal", () => {
    const proof = compareProofStates(
      captured({
        tables: [table("public", "users", 2, { content: "fp-a" })],
      }),
      captured({
        tables: [table("public", "users", 2, { content: "fp-b" })],
      }),
    );
    expect(proof.equal).toBe(false);
    expect(proof.tables[0]?.coverage).toBe("fingerprint");
  });

  test("schemaSig mismatch uses count coverage", () => {
    const proof = compareProofStates(
      captured({
        tables: [
          table("public", "users", 3, {
            schemaSig: "int",
            content: "fp-a",
          }),
        ],
      }),
      captured({
        tables: [
          table("public", "users", 3, {
            schemaSig: "text",
            content: "fp-b",
          }),
        ],
      }),
    );
    expect(proof.tables[0]?.coverage).toBe("count");
    expect(proof.equal).toBe(true);
  });

  test("count coverage fails when row counts differ", () => {
    const proof = compareProofStates(
      captured({
        tables: [table("public", "users", 3, { schemaSig: "int" })],
      }),
      captured({
        tables: [table("public", "users", 4, { schemaSig: "text" })],
      }),
    );
    expect(proof.tables[0]?.coverage).toBe("count");
    expect(proof.equal).toBe(false);
  });

  test("table missing on one side is coverage none and not equal", () => {
    const proof = compareProofStates(
      captured({
        tables: [table("public", "users", 1, { content: "fp" })],
      }),
      captured({ tables: [] }),
    );
    expect(proof.equal).toBe(false);
    expect(proof.tables).toHaveLength(1);
    expect(proof.tables[0]?.coverage).toBe("none");
    expect(proof.tables[0]?.schema).toBe("public");
    expect(proof.tables[0]?.name).toBe("users");
  });

  test("empty tables use none coverage and stay equal", () => {
    const proof = compareProofStates(
      captured({
        tables: [table("public", "empty", 0)],
      }),
      captured({
        tables: [table("public", "empty", 0)],
      }),
    );
    expect(proof.tables[0]?.coverage).toBe("none");
    expect(proof.tables[0]?.originalRows).toBe(0);
    expect(proof.tables[0]?.candidateRows).toBe(0);
    expect(proof.equal).toBe(true);
  });

  test("tables are keyed by JSON [schema, name], not dotted strings", () => {
    const proof = compareProofStates(
      captured({
        tables: [table("a.b", "c", 1, { content: "fp" })],
      }),
      captured({
        tables: [table("a", "b.c", 1, { content: "fp" })],
      }),
    );
    expect(proof.equal).toBe(false);
    expect(proof.tables).toHaveLength(2);
    expect(proof.tables.every((t) => t.coverage === "none")).toBe(true);
  });

  test("missing content on a non-empty table falls back to count coverage", () => {
    const proof = compareProofStates(
      captured({
        tables: [table("public", "users", 2, { schemaSig: "sig" })],
      }),
      captured({
        tables: [table("public", "users", 2, { schemaSig: "sig" })],
      }),
    );
    expect(proof.tables[0]?.coverage).toBe("count");
    expect(proof.equal).toBe(true);
  });
});
