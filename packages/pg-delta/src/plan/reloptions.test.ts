/**
 * View / table reloptions are facts now (supabase/cli#5476, Codex review): an
 * options-only change (security_invoker, fillfactor, …) plans an
 * `ALTER … SET/RESET` instead of being invisible. Before this, reloptions were
 * not extracted, so source and desired hashed identically and nothing planned —
 * each test below produced ZERO actions. Pure rule/diff level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};
const viewId: StableId = { kind: "view", schema: "app", name: "v" };
const viewFact = (reloptions: string[] | null): Fact => ({
  id: viewId,
  parent: { kind: "schema", name: "app" },
  payload: { def: " SELECT 1;", reloptions },
});
const tableId: StableId = { kind: "table", schema: "app", name: "t" };
const tableFact = (reloptions: string[] | null): Fact => ({
  id: tableId,
  parent: { kind: "schema", name: "app" },
  payload: { owner: "test", persistence: "p", reloptions },
});
const base = (extra: Fact[]) => buildFactBase([schemaFact, ...extra], []);

describe("view reloptions", () => {
  test("create carries the WITH (...) clause", () => {
    const sql = plan(
      base([]),
      base([viewFact(["security_invoker=true"])]),
    ).actions.map((a) => a.sql);
    expect(sql).toContain(
      `CREATE VIEW "app"."v" WITH (security_invoker=true) AS  SELECT 1;`,
    );
  });

  test("an options-only swap plans SET + RESET (was invisible before)", () => {
    const sql = plan(
      base([viewFact(["security_barrier=true"])]),
      base([viewFact(["security_invoker=true"])]),
    ).actions.map((a) => a.sql);
    expect(sql).toContain(`ALTER VIEW "app"."v" SET (security_invoker=true)`);
    expect(sql).toContain(`ALTER VIEW "app"."v" RESET (security_barrier)`);
  });

  test("dropping every option plans a RESET", () => {
    const sql = plan(
      base([viewFact(["security_invoker=true"])]),
      base([viewFact(null)]),
    ).actions.map((a) => a.sql);
    expect(sql).toContain(`ALTER VIEW "app"."v" RESET (security_invoker)`);
  });
});

describe("table reloptions", () => {
  test("a storage-option change plans an ALTER TABLE SET", () => {
    const sql = plan(
      base([tableFact(["fillfactor=70"])]),
      base([tableFact(["fillfactor=90"])]),
    ).actions.map((a) => a.sql);
    expect(sql).toContain(`ALTER TABLE "app"."t" SET (fillfactor=90)`);
  });
});
