/**
 * Guardrail 3: PostgreSQL object-kind knowledge belongs in plan/rules/**.
 *
 * Planner-body modules still contain deliberate legacy FactKind literal
 * occurrences. This per-file count-proxy ratchet pins that footprint: adding
 * an occurrence fails here, while removing one requires lowering the
 * documented baseline in the same change.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
  createSourceFile,
  forEachChild,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  type Node,
  ScriptKind,
  ScriptTarget,
} from "typescript";
import { ALL_FACT_KINDS } from "../core/stable-id.ts";

const PLAN_ROOT = fileURLToPath(new URL(".", import.meta.url));
const FACT_KIND_SET = new Set<string>(ALL_FACT_KINDS);

function isPlannerBodyModuleFilename(name: string): boolean {
  return /\.(?:cts|mts|ts|tsx)$/.test(name) && !name.endsWith(".test.ts");
}

// Every production module outside plan/rules/** has an entry, including files
// with zero FactKind literal occurrences. Keep this table sorted by path.
const KIND_LITERAL_BASELINE: Readonly<Record<string, number>> = {
  "artifact.ts": 73,
  "graph.ts": 0,
  "identity-normalize.ts": 17,
  "internal.ts": 28,
  "locks.ts": 18,
  "phases/action-emitter.ts": 10,
  "phases/action-graph.ts": 1,
  "phases/change-set.ts": 4,
  "phases/replacement-expansion.ts": 0,
  "plan.ts": 7,
  // preamble.ts classifies actions into "routine-family or not" for the
  // cosmetic check_function_bodies compaction; the routine kinds themselves
  // come from core ROUTINE_KINDS, leaving only the two extension literals.
  "preamble.ts": 2,
  "project.ts": 0,
  "renames.ts": 0,
  "render-sql.ts": 0,
  "render.ts": 38,
  "rule-flags.ts": 0,
  "rules.ts": 1,
  "safety.ts": 30,
};

function listPlannerBodyModules(dir: string = PLAN_ROOT): string[] {
  const modules: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (relative(PLAN_ROOT, path).replaceAll("\\", "/") === "rules") {
        continue;
      }
      modules.push(...listPlannerBodyModules(path));
      continue;
    }
    if (!isPlannerBodyModuleFilename(name)) continue;
    modules.push(path);
  }
  return modules.sort();
}

function countFactKindLiterals(
  source: string,
  filename = "planner-body.ts",
): number {
  const sourceFile = createSourceFile(
    filename,
    source,
    ScriptTarget.Latest,
    true,
    filename.endsWith(".tsx") ? ScriptKind.TSX : ScriptKind.TS,
  );
  let count = 0;

  function visit(node: Node): void {
    if (
      (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) &&
      FACT_KIND_SET.has(node.text)
    ) {
      count += 1;
    }

    forEachChild(node, visit);
  }

  visit(sourceFile);
  return count;
}

function currentKindLiteralCounts(): Record<string, number> {
  return Object.fromEntries(
    listPlannerBodyModules().map((path) => [
      relative(PLAN_ROOT, path).replaceAll("\\", "/"),
      countFactKindLiterals(readFileSync(path, "utf8"), path),
    ]),
  );
}

describe("planner body FactKind literal-count proxy ratchet", () => {
  test("recognizes production TypeScript module filenames", () => {
    for (const name of [
      "artifact.ts",
      "artifact.mts",
      "artifact.cts",
      "artifact.tsx",
      "artifact.test.mts",
      "artifact.test.cts",
      "artifact.test.tsx",
    ]) {
      expect(isPlannerBodyModuleFilename(name)).toBe(true);
    }
    for (const name of ["artifact.test.ts", "artifact.js", "artifact.sql"]) {
      expect(isPlannerBodyModuleFilename(name)).toBe(false);
    }
  });

  test("detects fact-kind literals but ignores comments and unrelated strings", () => {
    const source = `
      if (fact.id.kind === "table") return;
      switch (parent.kind) {
        case 'schema': return;
        case \`role\`: return;
      }
      // if (fact.id.kind === "policy") return;
      /* case "view": return; */
      throw new Error("not-a-kind");
    `;

    expect(countFactKindLiterals(source)).toBe(3);
  });

  test("does not mistake comment markers inside literals for comments", () => {
    const source = `
      const lineCommentText = "literal // text"; const laterKind = "policy";
      const blockCommentText = \`literal /* text \${"view"} */ text\`;
    `;

    expect(countFactKindLiterals(source)).toBe(2);
  });

  test("does not count fact-kind text inside regular expressions", () => {
    const source = String.raw`const pattern = /["table"]/;`;

    expect(countFactKindLiterals(source)).toBe(0);
  });

  test("counts literals after regular expressions inside template interpolations", () => {
    const source = 'const label = `${/}/.test(input) ? "table" : "view"}`;';

    expect(countFactKindLiterals(source)).toBe(2);
  });

  test("parses FactKind literals in TSX modules", () => {
    const source = 'const element = <Widget kind="table" />;';

    expect(countFactKindLiterals(source, "planner-body.tsx")).toBe(1);
  });

  test("does not grow outside plan/rules", () => {
    expect(currentKindLiteralCounts()).toEqual(KIND_LITERAL_BASELINE);
  });
});
