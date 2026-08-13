/**
 * A NON-relocatable extension whose `schema` changes is planned as DROP +
 * CREATE (replace). Its members are reference-only — they vanish with the DROP
 * and re-materialize with the CREATE — so the replace must never emit
 * standalone member DROP/CREATE actions, and actions that consume a member id
 * (a satellite customization, a user object living in an extension-owned
 * schema) must order against ONE side of the replace, not both.
 *
 * Production shape (Sentry event 06bb0a36, pg-delta-next): a pg_net
 * `extnamespace` drift planned DROP/CREATE EXTENSION pg_net plus DROP/CREATE
 * for every `net.*` member function, and topoSort threw "dependency cycle
 * among 21 actions". Two rule bugs cooperated:
 *
 *  1. the forced dependent rebuild followed `memberOfExtension` edges, pulling
 *     reference-only members into `replaceIds` (replacement-expansion.ts);
 *  2. the extension↔member ordering edges demanded every member-consuming
 *     action run both AFTER `CREATE EXTENSION` and BEFORE `DROP EXTENSION`,
 *     which is unsatisfiable across a replace (internal.ts).
 *
 * No Docker required — synthetic fact bases exercise the planner wiring.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const publicSchema: StableId = { kind: "schema", name: "public" };
const extensionsSchema: StableId = { kind: "schema", name: "extensions" };
const pgNet: StableId = { kind: "extension", name: "pg_net" };
const netSchema: StableId = { kind: "schema", name: "net" };
const httpGet: StableId = {
  kind: "function",
  schema: "net",
  name: "http_get",
  args: ["text"],
};

const f = (id: StableId, payload: Fact["payload"] = {}): Fact => ({
  id,
  payload,
});

/** pg_net-shaped facts: the extension owns schema `net` AND a function inside
 *  it (both carry `memberOfExtension` edges), plus extra user-side facts. */
const pgNetBase = (
  extSchema: string,
  extraFacts: Fact[] = [],
  extraEdges: Parameters<typeof buildFactBase>[1] = [],
) =>
  buildFactBase(
    [
      f(publicSchema),
      f(extensionsSchema),
      f(pgNet, { schema: extSchema, relocatable: false }),
      f(netSchema),
      {
        id: httpGet,
        parent: netSchema,
        payload: {
          def: `CREATE OR REPLACE FUNCTION net.http_get(url text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$`,
        },
      },
      ...extraFacts,
    ],
    [
      { from: netSchema, to: pgNet, kind: "memberOfExtension" },
      { from: httpGet, to: pgNet, kind: "memberOfExtension" },
      { from: httpGet, to: netSchema, kind: "depends" },
      ...extraEdges,
    ],
  );

describe("plan() — non-relocatable extension replace with member-owned schema", () => {
  test("the replace never emits standalone member DROP/CREATE and sorts DROP before CREATE", () => {
    const source = pgNetBase("public");
    const desired = pgNetBase("extensions");

    const thePlan = plan(source, desired);
    const sqls = thePlan.actions.map((a) => a.sql);

    const dropAt = sqls.findIndex((s) => s === `DROP EXTENSION "pg_net"`);
    const createAt = sqls.findIndex(
      (s) => s === `CREATE EXTENSION "pg_net" SCHEMA "extensions"`,
    );
    expect(dropAt).toBeGreaterThanOrEqual(0);
    expect(createAt).toBeGreaterThan(dropAt);
    // the member function converges VIA the extension — never its own action
    expect(sqls.some((s) => /FUNCTION "?net"?\./i.test(s))).toBe(false);
    expect(thePlan.actions).toHaveLength(2);
  });

  test("a user function inside the extension-owned schema replans around the replace", () => {
    const report: StableId = {
      kind: "function",
      schema: "net",
      name: "report",
      args: [],
    };
    const userFn = (returnType: string): Fact => ({
      id: report,
      parent: netSchema,
      payload: {
        def: `CREATE OR REPLACE FUNCTION net.report() RETURNS ${returnType} LANGUAGE sql AS $$ SELECT 1 $$`,
        returnType,
      },
    });
    const source = pgNetBase(
      "public",
      [userFn("bigint")],
      [{ from: report, to: netSchema, kind: "depends" }],
    );
    // returnType change forces the user function's own replace
    const desired = pgNetBase(
      "extensions",
      [userFn("integer")],
      [{ from: report, to: netSchema, kind: "depends" }],
    );

    const thePlan = plan(source, desired);
    const sqls = thePlan.actions.map((a) => a.sql);

    const dropFnAt = sqls.findIndex(
      (s) => s === `DROP FUNCTION "net"."report"()`,
    );
    const dropExtAt = sqls.findIndex((s) => s === `DROP EXTENSION "pg_net"`);
    const createExtAt = sqls.findIndex(
      (s) => s === `CREATE EXTENSION "pg_net" SCHEMA "extensions"`,
    );
    const createFnAt = sqls.findIndex((s) =>
      s.includes("FUNCTION net.report() RETURNS integer"),
    );
    // teardown belongs to the OLD incarnation, build-up to the NEW one:
    // DROP FN → DROP EXT → CREATE EXT → CREATE FN
    expect(dropFnAt).toBeGreaterThanOrEqual(0);
    expect(dropExtAt).toBeGreaterThan(dropFnAt);
    expect(createExtAt).toBeGreaterThan(dropExtAt);
    expect(createFnAt).toBeGreaterThan(createExtAt);
  });

  test("a satellite customization added on a member orders after the re-CREATE", () => {
    const comment: StableId = { kind: "comment", target: httpGet };
    const source = pgNetBase("public");
    const desired = pgNetBase("extensions", [
      { id: comment, parent: httpGet, payload: { text: "customized" } },
    ]);

    const thePlan = plan(source, desired);
    const sqls = thePlan.actions.map((a) => a.sql);

    const createExtAt = sqls.findIndex(
      (s) => s === `CREATE EXTENSION "pg_net" SCHEMA "extensions"`,
    );
    const commentAt = sqls.findIndex((s) =>
      s.startsWith(`COMMENT ON FUNCTION "net"."http_get"`),
    );
    // the customization targets the NEW incarnation (the member re-materializes
    // with CREATE EXTENSION), so it must follow the re-create — and must not be
    // dragged BEFORE the DROP by the source-side member edge.
    expect(commentAt).toBeGreaterThan(createExtAt);
  });

  // The mirror of the previous case: the satellite exists only on the SOURCE
  // (a customization the desired state removes). Its removal action destroys
  // only metadata, so it targets the NEW incarnation too — the re-created
  // member may re-materialize script state the desired side doesn't want. The
  // child-teardown rule must not pin it before DROP EXTENSION (its consumes
  // orders it after the re-CREATE → the pair would be a cycle).
  test("a satellite customization removed from a member orders after the re-CREATE", () => {
    const comment: StableId = { kind: "comment", target: httpGet };
    const source = pgNetBase("public", [
      { id: comment, parent: httpGet, payload: { text: "old note" } },
    ]);
    const desired = pgNetBase("extensions");

    const thePlan = plan(source, desired);
    const sqls = thePlan.actions.map((a) => a.sql);

    const createExtAt = sqls.findIndex(
      (s) => s === `CREATE EXTENSION "pg_net" SCHEMA "extensions"`,
    );
    const commentAt = sqls.findIndex((s) =>
      s.startsWith(`COMMENT ON FUNCTION "net"."http_get"`),
    );
    expect(createExtAt).toBeGreaterThanOrEqual(0);
    expect(commentAt).toBeGreaterThan(createExtAt);
  });

  // An UNCHANGED user object that depends on a member (not on the member's
  // schema) is a real casualty of the replace: the member vanishes with
  // DROP EXTENSION, so the dependent must be rebuilt around it. The rebuild
  // walk keeps members out of replaceIds but must still traverse THROUGH them
  // to reach such dependents — otherwise the plan refuses with a
  // missing-requirement error ("survives but depends on … which this plan
  // drops without recreating").
  test("an unchanged user function depending on a member rebuilds around the replace", () => {
    const wrapper: StableId = {
      kind: "function",
      schema: "public",
      name: "wrapper",
      args: [],
    };
    const wrapperFact: Fact = {
      id: wrapper,
      parent: publicSchema,
      payload: {
        def: `CREATE OR REPLACE FUNCTION public.wrapper() RETURNS bigint LANGUAGE plpgsql AS $$ begin return net.http_get('x'); end $$`,
      },
    };
    const wrapperEdges: Parameters<typeof buildFactBase>[1] = [
      { from: wrapper, to: httpGet, kind: "depends" },
    ];
    const source = pgNetBase("public", [wrapperFact], wrapperEdges);
    const desired = pgNetBase("extensions", [wrapperFact], wrapperEdges);

    const thePlan = plan(source, desired);
    const sqls = thePlan.actions.map((a) => a.sql);

    const dropWrapperAt = sqls.findIndex(
      (s) => s === `DROP FUNCTION "public"."wrapper"()`,
    );
    const dropExtAt = sqls.findIndex((s) => s === `DROP EXTENSION "pg_net"`);
    const createExtAt = sqls.findIndex(
      (s) => s === `CREATE EXTENSION "pg_net" SCHEMA "extensions"`,
    );
    const createWrapperAt = sqls.findIndex((s) =>
      s.includes("FUNCTION public.wrapper()"),
    );
    expect(dropWrapperAt).toBeGreaterThanOrEqual(0);
    expect(dropExtAt).toBeGreaterThan(dropWrapperAt);
    expect(createExtAt).toBeGreaterThan(dropExtAt);
    expect(createWrapperAt).toBeGreaterThan(createExtAt);
  });
});
