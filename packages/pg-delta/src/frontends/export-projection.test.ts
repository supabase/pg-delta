/**
 * `schema export --profile` must export the MANAGED VIEW, not the raw
 * extraction (Codex review): an object in a policy-hidden schema must not be
 * written into the declarative files (or it reappears as drift on apply). This
 * pins the projection composition the CLI command now performs
 * (resolveView → exportSqlFiles); before, the raw fact base was exported.
 * Pure — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { exportSqlFiles } from "./export-sql-files.ts";
import { resolveView } from "../policy/policy.ts";
import { supabasePolicy } from "../policy/supabase.ts";

const facts: Fact[] = [
  { id: { kind: "schema", name: "app" }, payload: {} },
  { id: { kind: "schema", name: "auth" }, payload: {} }, // system schema
  {
    id: { kind: "table", schema: "app", name: "widgets" },
    parent: { kind: "schema", name: "app" },
    payload: { persistence: "p" },
  },
  {
    id: { kind: "table", schema: "auth", name: "users" }, // platform object
    parent: { kind: "schema", name: "auth" },
    payload: { persistence: "p" },
  },
];

describe("schema export projects the managed view", () => {
  test("a policy-hidden schema's objects are not exported", () => {
    const fb = buildFactBase(facts, []);
    const view = resolveView(fb, supabasePolicy);
    const dump = exportSqlFiles(view, { layout: "by-object" })
      .map((f) => `${f.name}\n${f.sql}`)
      .join("\n");
    expect(dump).toContain("widgets"); // user object survives
    expect(dump).not.toContain("auth"); // platform schema/table excluded
  });

  test("without a policy the raw fact base is exported (identity projection)", () => {
    const fb = buildFactBase(facts, []);
    const dump = exportSqlFiles(resolveView(fb, undefined), {
      layout: "by-object",
    })
      .map((f) => `${f.name}\n${f.sql}`)
      .join("\n");
    expect(dump).toContain("widgets");
    expect(dump).toContain("auth");
  });
});
