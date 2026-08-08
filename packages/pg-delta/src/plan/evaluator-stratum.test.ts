/**
 * The evaluator stratum: an action that makes PostgreSQL RUN a user expression
 * while applying (a column DEFAULT backfill, a generated-column backfill, a
 * CHECK validation scan, an expression-index build, a materialized-view
 * populate) needs the TRANSITIVE closure of the routine call graph — but
 * pg_depend only records the DIRECT reference. A quoted (non-`BEGIN ATOMIC`)
 * SQL body's internal calls are invisible to the catalog, so the engine cannot
 * learn them.
 *
 * The scheduler therefore sinks evaluator actions below every simultaneously
 * ready DEFINITION action: `ADD COLUMN … DEFAULT referenced()` must not
 * overtake a still-ready `CREATE FUNCTION helper()` just because the column
 * kind weight (5) sorts ahead of the routine weight (8).
 *
 * Pure — no DB. Only `referenced` carries a pg_depend edge from the default;
 * `helper` is the hop hidden inside `referenced`'s quoted body, so it is
 * unreachable through the graph and only the tie-break can order it first.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaId: StableId = { kind: "schema", name: "app" };
const schemaFact: Fact = { id: schemaId, payload: { owner: "test" } };

const tableId: StableId = { kind: "table", schema: "app", name: "downloads" };
const tableFact: Fact = {
  id: tableId,
  parent: schemaId,
  payload: { owner: "test", persistence: "p" },
};
const idColumn: Fact = {
  id: { kind: "column", schema: "app", table: "downloads", name: "id" },
  parent: tableId,
  payload: {
    _position: 1,
    type: "bigint",
    notNull: true,
    collation: null,
    generatedExpr: null,
  },
};
const clientInfoId: StableId = {
  kind: "column",
  schema: "app",
  table: "downloads",
  name: "client_info",
};
const clientInfoColumn: Fact = {
  id: clientInfoId,
  parent: tableId,
  payload: {
    _position: 2,
    type: "text",
    notNull: false,
    collation: null,
    generatedExpr: null,
  },
};
const defaultId: StableId = {
  kind: "default",
  schema: "app",
  table: "downloads",
  name: "client_info",
};
const defaultFact: Fact = {
  id: defaultId,
  parent: clientInfoId,
  payload: { expr: `app.api_request_client_info()` },
};

// `api_request_client_info` sorts BEFORE `api_request_header` by encoded id, so
// the pre-fix tie-break created the referenced routine, then took the (lighter)
// column create, leaving the helper for last.
const routine = (name: string, body: string): Fact => ({
  id: { kind: "function", schema: "app", name, args: [] },
  parent: schemaId,
  payload: {
    def: `CREATE FUNCTION "app"."${name}"() RETURNS text LANGUAGE sql STABLE AS $$${body}$$`,
  },
});
const referenced = routine(
  "api_request_client_info",
  "SELECT app.api_request_header()",
);
const helper = routine("api_request_header", "SELECT 'user-agent'");

// the ONLY recorded edge: the default's direct reference.
const edges: DependencyEdge[] = [
  { from: defaultId, to: referenced.id, kind: "depends" },
];

describe("evaluator stratum", () => {
  test("both routine creates precede the default-bearing ADD COLUMN", () => {
    const source = buildFactBase([schemaFact, tableFact, idColumn], []);
    const desired = buildFactBase(
      [
        schemaFact,
        tableFact,
        idColumn,
        clientInfoColumn,
        defaultFact,
        referenced,
        helper,
      ],
      edges,
    );

    const sql = plan(source, desired).actions.map((a) => a.sql);
    const addColumn = sql.findIndex((s) => s.includes("ADD COLUMN"));
    const referencedAt = sql.findIndex((s) =>
      s.includes(`"api_request_client_info"`),
    );
    const helperAt = sql.findIndex((s) => s.includes(`"api_request_header"`));

    expect(addColumn).toBeGreaterThanOrEqual(0);
    expect(referencedAt).toBeGreaterThanOrEqual(0);
    expect(helperAt).toBeGreaterThanOrEqual(0);
    // the graph edge only guarantees the FIRST of these; the stratum guarantees
    // the second, and it is the one that was broken.
    expect(referencedAt).toBeLessThan(addColumn);
    expect(helperAt).toBeLessThan(addColumn);
  });

  test("a populating matview waits for a routine blocked behind another matview", () => {
    // `CREATE MATERIALIZED VIEW … AS <query>` carries no `WITH NO DATA`, so
    // applying it RUNS the query. `a_eval` calls `wrapper` (recorded edge);
    // wrapper's opaque body calls `z_helper`, which is itself blocked behind
    // `z_blocker` (`RETURNS SETOF z_blocker` — a recorded edge). Both matviews
    // share weight 13 and `a_eval` sorts first by encoded id, so only the
    // stratum can keep the populating one last.
    const matview = (name: string, def: string): Fact => ({
      id: { kind: "materializedView", schema: "app", name },
      parent: schemaId,
      payload: { owner: "test", def, reloptions: null },
    });
    const blocker = matview("z_blocker", "SELECT 1 AS n");
    const evaluating = matview("a_eval", "SELECT app.wrapper() AS n");
    const wrapper = routine("wrapper", "SELECT count(*) FROM app.z_helper()");
    const blockedHelper = routine("z_helper", "SELECT * FROM app.z_blocker");

    const source = buildFactBase([schemaFact], []);
    const desired = buildFactBase(
      [schemaFact, blocker, evaluating, wrapper, blockedHelper],
      [
        { from: evaluating.id, to: wrapper.id, kind: "depends" },
        { from: blockedHelper.id, to: blocker.id, kind: "depends" },
      ],
    );

    const sql = plan(source, desired).actions.map((a) => a.sql);
    const evaluatingAt = sql.findIndex((s) =>
      s.startsWith(`CREATE MATERIALIZED VIEW "app"."a_eval"`),
    );
    const helperAt = sql.findIndex((s) =>
      s.includes(`FUNCTION "app"."z_helper"`),
    );
    expect(evaluatingAt).toBeGreaterThanOrEqual(0);
    expect(helperAt).toBeGreaterThanOrEqual(0);
    expect(helperAt).toBeLessThan(evaluatingAt);
  });

  test("a routine-free default is NOT sunk (no ordering churn)", () => {
    // same shape, but the default is a literal with no routine edge: the column
    // create keeps its ordinary weight-5 slot ahead of the routine creates.
    const constantDefault: Fact = {
      id: defaultId,
      parent: clientInfoId,
      payload: { expr: `'unknown'::text` },
    };
    const source = buildFactBase([schemaFact, tableFact, idColumn], []);
    const desired = buildFactBase(
      [
        schemaFact,
        tableFact,
        idColumn,
        clientInfoColumn,
        constantDefault,
        referenced,
        helper,
      ],
      [],
    );

    const sql = plan(source, desired).actions.map((a) => a.sql);
    const addColumn = sql.findIndex((s) => s.includes("ADD COLUMN"));
    const referencedAt = sql.findIndex((s) =>
      s.includes(`"api_request_client_info"`),
    );
    expect(addColumn).toBeLessThan(referencedAt);
  });
});
