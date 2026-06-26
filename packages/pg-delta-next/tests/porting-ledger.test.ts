/**
 * Unit coverage for the porting-ledger audit (Tier 1 of the port-parity plan).
 *
 * Lives in tests/ (not scripts/) so it runs on the existing CI `test` job's
 * integration step on every PR — but it touches no database, so it is fast and
 * Docker-free. The in-sync invariant makes any porting-ledger.json drift fail
 * here, in addition to the explicit `bun run audit:porting` gate.
 */
import { describe, expect, test } from "bun:test";
import {
  audit,
  extractTestsFromSource,
} from "../scripts/audit-porting-ledger.ts";

describe("extractTestsFromSource", () => {
  test("captures test/it names across string and template forms", () => {
    const src = `
      describe("group", () => {
        test("plain string name", () => {});
        it('single quotes', () => {});
        test(\`template name\`, () => {});
      });
    `;
    expect(extractTestsFromSource(src, "f.ts")).toEqual([
      "plain string name",
      "single quotes",
      "template name",
    ]);
  });

  test("captures modifier forms (skip/only/skipIf) and wrapped callbacks", () => {
    const src = `
      test.skip("skipped", () => {});
      test.only("only", () => {});
      it.skipIf(cond)("conditional", () => {});
      test("wrapped", withDb(17, async (db) => {}));
    `;
    expect(extractTestsFromSource(src, "f.ts")).toEqual([
      "skipped",
      "only",
      "conditional",
      "wrapped",
    ]);
  });

  test("renders interpolated template names with a stable placeholder", () => {
    const src = "test(`a ${kind} label`, () => {});";
    expect(extractTestsFromSource(src, "f.ts")).toEqual(["a ${...} label"]);
  });

  test("ignores non-test calls and dynamic (non-literal) names", () => {
    const src = `
      expect(1).toBe(1);
      describe("d", () => {});
      test(someVariable, () => {});
    `;
    expect(extractTestsFromSource(src, "f.ts")).toEqual([]);
  });
});

describe("ledger audit invariant", () => {
  test("the committed porting-ledger.json is in sync with the old suite", () => {
    const result = audit();
    // Every old test (61 integration + 2 root) has exactly one ledger entry.
    expect(result.oldTestCount).toBeGreaterThan(0);
    expect(result.ledgerEntryCount).toBe(result.oldTestCount);
    if (result.findings.length > 0) {
      throw new Error(
        `porting-ledger drift:\n` +
          result.findings
            .map(
              (f) => `  [${f.kind}] ${f.file} :: ${f.testName} — ${f.detail}`,
            )
            .join("\n"),
      );
    }
    expect(result.findings).toEqual([]);
  });
});
