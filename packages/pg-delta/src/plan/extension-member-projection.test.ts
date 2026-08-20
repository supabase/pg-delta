/**
 * plan() applies the default extension-member projection (4b Stage 0).
 * No Docker / database required.
 *
 * Extension members are projected OUT of the managed universe on BOTH sides
 * before diffing (docs/archive/hardening-plan.md, "Item 4b"). This test
 * injects a `memberOfExtension` edge synthetically — decoupled from the
 * extractor flip (Stage 2) — so it pins the plan-side wiring on its own: a fact
 * an extension owns must never become a planned action, and the plan's target
 * fingerprint must reflect the member-excluded state.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { PlanOptions } from "./plan.ts";
import type { Policy } from "../policy/policy.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaPublic: StableId = { kind: "schema", name: "public" };
const extPgmq: StableId = { kind: "extension", name: "pgmq" };
// a schema the extension owns; member roots are kept as roots here so removing
// them never orphans the extension fact (the extension is not their descendant)
const memberSchema: StableId = { kind: "schema", name: "pgmq_internal" };

const f = (id: StableId, parent?: StableId): Fact =>
  parent ? { id, parent, payload: {} } : { id, payload: {} };

// No skipAuthorization needed: facts have no owner payload → no owner edge →
// CREATE SCHEMA needs no role (owner edge is absent, not suppressed).
const opts: PlanOptions = {};

describe("plan() — default extension-member projection (4b Stage 0)", () => {
  test("an extension-owned object never becomes a planned action", () => {
    const source = buildFactBase(
      [f(schemaPublic), f(extPgmq, schemaPublic)],
      [],
    );
    const desired = buildFactBase(
      [f(schemaPublic), f(extPgmq, schemaPublic), f(memberSchema)],
      [{ from: memberSchema, to: extPgmq, kind: "memberOfExtension" }],
    );

    const thePlan = plan(source, desired, opts);

    // The member is REFERENCE-ONLY (kept in the view so its satellites can be
    // diffed, but the member object itself is never a create/drop/alter action
    // and never a delta). It is present-at-apply via CREATE EXTENSION, so the
    // honest target retains it — the fingerprint therefore folds it in (reference-
    // only facts are part of rootHash), exactly like an assumed-schema object.
    expect(thePlan.actions).toHaveLength(0);
    expect(thePlan.deltas).toHaveLength(0);
  });

  test("a NON-member schema added in desired is still planned (no false suppression)", () => {
    const userSchema: StableId = { kind: "schema", name: "app" };
    const source = buildFactBase([f(schemaPublic)], []);
    const desired = buildFactBase([f(schemaPublic), f(userSchema)], []);

    const thePlan = plan(source, desired, opts);

    expect(thePlan.actions.length).toBeGreaterThan(0);
  });

  // A USER object created inside an extension-CREATED SCHEMA is NOT extension-
  // managed: the extension owns the schema, but a table the user adds under it
  // carries no memberOfExtension edge of its own. The member closure must stop
  // at a schema-kind root's children so such a table (and its comment/grant
  // satellites) diffs normally — otherwise the table is silently suppressed and
  // its satellite crashes the requirement guard.
  test("a user object under an extension-created schema is diffed (member closure stops at schema roots)", () => {
    const ext: StableId = { kind: "extension", name: "myext" };
    const memberSchema2: StableId = { kind: "schema", name: "myext_s" };
    const userTable: StableId = {
      kind: "table",
      schema: "myext_s",
      name: "t",
    };
    const comment: StableId = { kind: "comment", target: userTable };
    const source = buildFactBase([f(schemaPublic)], []);
    const desired = buildFactBase(
      [
        f(schemaPublic),
        {
          id: ext,
          parent: schemaPublic,
          payload: {
            schema: "myext_s",
            _relocatable: false,
          },
        },
        f(memberSchema2),
        { id: userTable, parent: memberSchema2, payload: { persistence: "p" } },
        { id: comment, parent: userTable, payload: { text: "user note" } },
      ],
      [{ from: memberSchema2, to: ext, kind: "memberOfExtension" }],
    );

    // RED today: userTable is a descendant of the member schema → reference-only
    // → its comment satellite is diffed and throws "missing requirement" because
    // isExtensionMember(userTable) is false. After the fix: the table + comment
    // are planned, ordered after CREATE EXTENSION.
    const thePlan = plan(source, desired, opts);
    const sql = thePlan.actions.map((a) => a.sql);
    expect(sql.some((s) => /CREATE TABLE "myext_s"."t"/.test(s))).toBe(true);
    expect(sql.some((s) => /COMMENT ON TABLE "myext_s"."t"/.test(s))).toBe(
      true,
    );
  });

  // Guard the boundary the other way: a member TABLE's own descendants
  // (columns/constraints) ARE extension-managed and stay reference-only — the
  // closure extends through non-schema roots.
  test("a member table's column stays reference-only (closure extends through table roots)", () => {
    const ext2: StableId = { kind: "extension", name: "ext2" };
    const memberTable: StableId = {
      kind: "table",
      schema: "public",
      name: "mt",
    };
    const memberCol: StableId = {
      kind: "column",
      schema: "public",
      table: "mt",
      name: "c",
    };
    const source = buildFactBase([f(schemaPublic)], []);
    const desired = buildFactBase(
      [
        f(schemaPublic),
        {
          id: ext2,
          parent: schemaPublic,
          payload: {
            schema: "public",
            _relocatable: true,
          },
        },
        f(memberTable, schemaPublic),
        { id: memberCol, parent: memberTable, payload: { type: "integer" } },
      ],
      [{ from: memberTable, to: ext2, kind: "memberOfExtension" }],
    );

    const thePlan = plan(source, desired, opts);
    const sql = thePlan.actions.map((a) => a.sql);
    // the member table and its column are never independently created
    expect(sql.some((s) => /"public"\."mt"/.test(s))).toBe(false);
  });

  // The requirement guard exempts a consumed extension member because it is
  // present-at-apply VIA its extension. That is only sound when the extension is
  // actually produced by the plan or already on the target. A policy that
  // filters the CREATE EXTENSION delta but keeps a member satellite must fail at
  // PLAN time ("a filter may be hiding its creation"), not silently ship a plan
  // that crashes at apply.
  const ext7: StableId = { kind: "extension", name: "e7" };
  const memberSchema7: StableId = { kind: "schema", name: "es7" };
  const comment7: StableId = { kind: "comment", target: memberSchema7 };
  const withExtAndComment = () =>
    buildFactBase(
      [
        f(schemaPublic),
        {
          id: ext7,
          parent: schemaPublic,
          payload: { schema: "es7", _relocatable: false },
        },
        f(memberSchema7),
        { id: comment7, parent: memberSchema7, payload: { text: "hi" } },
      ],
      [{ from: memberSchema7, to: ext7, kind: "memberOfExtension" }],
    );

  test("member exemption requires the extension to be produced or present — else missing-requirement throws", () => {
    const source = buildFactBase([f(schemaPublic)], []);
    const desired = withExtAndComment();
    // policy verb rule: keep the extension fact in the view but FILTER its add
    // delta, so no CREATE EXTENSION action is emitted while the member schema's
    // comment survives.
    const policy: Policy = {
      id: "p",
      filter: [
        {
          match: { all: [{ kind: "extension" }, { verb: "add" }] },
          action: "exclude",
        },
      ],
    };
    // RED today: isExtensionMember(es7) is true on edge alone, so the orphan
    // COMMENT ON is exempted and the plan validates. After the fix it throws.
    expect(() => plan(source, desired, { policy })).toThrow(
      /missing requirement/,
    );
  });

  test("member exemption holds when the extension IS produced in the plan (no false throw)", () => {
    const source = buildFactBase([f(schemaPublic)], []);
    const desired = withExtAndComment();
    // no filter → CREATE EXTENSION e7 is planned, so the comment on its member
    // schema is legitimately exempt + ordered after it.
    const thePlan = plan(source, desired, opts);
    const sql = thePlan.actions.map((a) => a.sql);
    expect(sql.some((s) => /CREATE EXTENSION "e7"/.test(s))).toBe(true);
    expect(sql.some((s) => /COMMENT ON SCHEMA "es7"/.test(s))).toBe(true);
  });
});
