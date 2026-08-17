import { describe, expect, expectTypeOf, test } from "bun:test";
import type {
  ByteRange,
  ClusterHandle,
  Diagnostic,
  DiagnosticCode,
  RunnerSemantics,
  Segment,
  SourceRef,
  SquashResult,
  SquashStatement,
  TxnKind,
} from "../index.ts";

describe("frozen type contract", () => {
  test("v1 RunnerSemantics is the CLI-accurate shared-session mode", () => {
    const semantics: RunnerSemantics = "per-file-transaction-shared-session";
    expect(semantics).toBe("per-file-transaction-shared-session");
    expectTypeOf<RunnerSemantics>().toEqualTypeOf<"per-file-transaction-shared-session">();
  });

  test("ByteRange is UTF-8 start/end offsets", () => {
    const range: ByteRange = { start: 0, end: 4 };
    expect(range.end).toBeGreaterThan(range.start);
    expectTypeOf<ByteRange>().toEqualTypeOf<{ start: number; end: number }>();
  });

  test("SourceRef names a statement by file, index, and byte range", () => {
    const source: SourceRef = {
      file: "20240101_create_users.sql",
      statementIndex: 0,
      bytes: { start: 0, end: 10 },
    };
    expect(source.file).toContain(".sql");
    expectTypeOf<SourceRef["bytes"]>().toEqualTypeOf<ByteRange>();
  });

  test("TxnKind covers TransactionStmt variants", () => {
    const kinds: TxnKind[] = [
      "begin",
      "commit",
      "rollback",
      "savepoint",
      "rollback_to",
      "release",
    ];
    expect(kinds).toHaveLength(6);
  });

  test("Segment is a closed union of txn, barrier, and opaqueFile", () => {
    const txn: Segment = {
      type: "txn",
      statements: [
        {
          text: "CREATE TABLE t (id int);",
          source: {
            file: "a.sql",
            statementIndex: 0,
            bytes: { start: 0, end: 24 },
          },
        } satisfies SquashStatement,
      ],
    };
    expect(txn.type).toBe("txn");
    expectTypeOf<Segment["type"]>().toEqualTypeOf<
      "txn" | "barrier" | "opaqueFile"
    >();
  });

  test("DiagnosticCode is the closed v1 set", () => {
    const codes: DiagnosticCode[] = [
      "opaque-file",
      "refused-statement",
      "repair-split",
      "parse-error",
      "barrier-runtime",
      "explicit-txn-floor",
    ];
    expect(codes).toHaveLength(6);
    expectTypeOf<Diagnostic["code"]>().toEqualTypeOf<DiagnosticCode>();
  });

  test("SquashResult carries files, manifest, proof, and diagnostics", () => {
    const result: SquashResult = {
      files: [{ name: "0001_squashed.sql", sql: "BEGIN; COMMIT;" }],
      manifest: undefined,
      proof: undefined,
      diagnostics: [],
    };
    expect(result.files).toHaveLength(1);
    expectTypeOf<ClusterHandle["pgMajor"]>().toEqualTypeOf<number>();
  });
});
