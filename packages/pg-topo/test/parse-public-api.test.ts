import { describe, expect, test } from "bun:test";
import { parseSqlContent, type ParseContentResult } from "../src/index.ts";

const txnNode = (ast: unknown): { kind?: string } | undefined => {
  if (ast && typeof ast === "object" && "TransactionStmt" in ast) {
    return (ast as { TransactionStmt: { kind?: string } }).TransactionStmt;
  }
  return undefined;
};

describe("parseSqlContent public export", () => {
  test("is exported from the package barrel", () => {
    expect(typeof parseSqlContent).toBe("function");
  });

  test("splits statements with UTF-8 byte offsets (not JS string indices)", async () => {
    const content = "COMMENT ON TRIGGER tr ON public.t IS '→→→';";
    const result: ParseContentResult = await parseSqlContent(
      content,
      "trigger.sql",
    );
    expect(result.diagnostics).toHaveLength(0);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]?.sql).toBe(content);
  });

  test("round-trips BEGIN as TransactionStmt TRANS_STMT_BEGIN", async () => {
    const result = await parseSqlContent("BEGIN;", "txn.sql");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.statements).toHaveLength(1);
    expect(txnNode(result.statements[0]?.ast)?.kind).toBe("TRANS_STMT_BEGIN");
  });

  test("round-trips SAVEPOINT as TransactionStmt TRANS_STMT_SAVEPOINT", async () => {
    const result = await parseSqlContent("SAVEPOINT sp;", "txn.sql");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.statements).toHaveLength(1);
    expect(txnNode(result.statements[0]?.ast)?.kind).toBe(
      "TRANS_STMT_SAVEPOINT",
    );
  });

  test("round-trips ROLLBACK TO as TransactionStmt TRANS_STMT_ROLLBACK_TO", async () => {
    const result = await parseSqlContent(
      "ROLLBACK TO SAVEPOINT sp;",
      "txn.sql",
    );
    expect(result.diagnostics).toHaveLength(0);
    expect(result.statements).toHaveLength(1);
    expect(txnNode(result.statements[0]?.ast)?.kind).toBe(
      "TRANS_STMT_ROLLBACK_TO",
    );
  });
});
