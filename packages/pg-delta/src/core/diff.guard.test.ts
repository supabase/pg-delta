/**
 * Guard (stage-4 gate): the differ must contain ZERO per-kind knowledge —
 * all per-kind significance is the rule table's job (§3.5). Crude but
 * effective: grep the differ source for any object-kind name. If the differ
 * ever branches on a kind, this fails.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const FACT_KINDS = [
  "schema",
  "role",
  "extension",
  "table",
  "view",
  "materializedView",
  "foreignTable",
  "sequence",
  "index",
  "collation",
  "domain",
  "type",
  "column",
  "constraint",
  "trigger",
  "rule",
  "policy",
  "default",
  "membership",
  "userMapping",
  "typeAttribute",
  "publicationRel",
  "publicationSchema",
  "securityLabel",
  "defaultPrivilege",
  "function",
  "procedure",
  "aggregate",
  "publication",
  "subscription",
  "fdw",
  "server",
  "eventTrigger",
];

describe("differ is kind-free (guardrail: granularity is one)", () => {
  test("diff.ts source references no object-kind name", () => {
    const src = readFileSync(new URL("./diff.ts", import.meta.url), "utf8");
    // strip comments so prose ("what a table is") doesn't trip the grep
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const leaked = FACT_KINDS.filter((kind) =>
      new RegExp(`["'\\.]${kind}\\b`).test(code),
    );
    expect(leaked).toEqual([]);
  });
});
