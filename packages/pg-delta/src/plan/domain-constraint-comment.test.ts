/**
 * A comment on a DOMAIN constraint must render `COMMENT ON CONSTRAINT … ON
 * DOMAIN …`, not the table form (Codex review). The constraint id is shaped
 * identically to a table constraint, so the satellite carries an `onDomain`
 * flag (set at extraction) that the comment rule renders from. Pure — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};

// --- domain + its CHECK constraint ---
const domainFact: Fact = {
  id: { kind: "domain", schema: "app", name: "d" },
  parent: { kind: "schema", name: "app" },
  payload: {
    baseType: "integer",
    notNull: false,
    default: null,
    collation: null,
  },
};
const domainConId: StableId = {
  kind: "constraint",
  schema: "app",
  table: "d",
  name: "d_check",
};
const domainConFact: Fact = {
  id: domainConId,
  parent: { kind: "domain", schema: "app", name: "d" },
  payload: { def: "CHECK (VALUE > 0)", type: "c", validated: true },
};

// --- table + its CHECK constraint (guard: must stay the table form) ---
const tableFact: Fact = {
  id: { kind: "table", schema: "app", name: "t" },
  parent: { kind: "schema", name: "app" },
  payload: { owner: "test", persistence: "p" },
};
const tableConId: StableId = {
  kind: "constraint",
  schema: "app",
  table: "t",
  name: "t_check",
};
const tableConFact: Fact = {
  id: tableConId,
  parent: { kind: "table", schema: "app", name: "t" },
  payload: { def: "CHECK (n > 0)", type: "c", validated: true },
};

const comment = (target: StableId, onDomain: boolean): Fact => ({
  id: { kind: "comment", target },
  parent: target,
  payload: onDomain ? { text: "chk", onDomain: true } : { text: "chk" },
});

const base = (extra: Fact[]) =>
  buildFactBase(
    [schemaFact, domainFact, domainConFact, tableFact, tableConFact, ...extra],
    [],
  );

describe("comment target for domain vs table constraints", () => {
  test("domain constraint uses COMMENT ON CONSTRAINT … ON DOMAIN", () => {
    const sql = plan(base([]), base([comment(domainConId, true)])).actions.map(
      (a) => a.sql,
    );
    expect(sql).toContain(
      `COMMENT ON CONSTRAINT "d_check" ON DOMAIN "app"."d" IS 'chk'`,
    );
  });

  test("table constraint still uses the table form", () => {
    const sql = plan(base([]), base([comment(tableConId, false)])).actions.map(
      (a) => a.sql,
    );
    expect(sql).toContain(
      `COMMENT ON CONSTRAINT "t_check" ON "app"."t" IS 'chk'`,
    );
  });
});
