/**
 * The `CREATE EXTENSION … SCHEMA` clause is a PLAN-TIME decision based on the
 * target schema's PRESENCE, not the extension's `relocatable` field: emit
 * `SCHEMA s` iff `s` is present on the target or produced by this plan (order
 * the extension after it), else emit the bare form so an extension that creates
 * its own schema (pgmq) does not reference a not-yet-existing schema.
 *
 * No Docker required — synthetic fact bases exercise the rule + planner wiring.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { contentHash } from "../core/hash.ts";
import type { StableId } from "../core/stable-id.ts";
import { extensionPayload } from "../extract/schemas.ts";
import { plan } from "./plan.ts";

const publicSchema: StableId = { kind: "schema", name: "public" };
const f = (id: StableId, payload: Fact["payload"] = {}): Fact => ({
  id,
  payload,
});

describe("extension SCHEMA clause derived from schema presence", () => {
  test("an extension whose schema is neither present nor produced emits a bare CREATE", () => {
    const pgmq: StableId = { kind: "extension", name: "pgmq" };
    const source = buildFactBase([f(publicSchema)], []);
    // desired adds pgmq (installs its own `pgmq` schema). The `pgmq` schema is
    // NOT a fact and is NOT produced by the plan → the extension must create it.
    const desired = buildFactBase(
      [f(publicSchema), f(pgmq, { schema: "pgmq", _relocatable: false })],
      [],
    );
    // bare CREATE, no schema requirement, exactly one action (no guard throw).
    const thePlan = plan(source, desired);
    expect(thePlan.actions).toHaveLength(1);
    expect(thePlan.actions[0]!.sql).toBe(`CREATE EXTENSION "pgmq"`);
  });

  test("an extension whose target schema is produced by the plan emits SCHEMA and is ordered after it", () => {
    const hstore: StableId = { kind: "extension", name: "hstore" };
    const app: StableId = { kind: "schema", name: "app" };
    const source = buildFactBase([f(publicSchema)], []);
    // desired adds a managed `app` schema AND hstore installed into it → the
    // extension emits `SCHEMA app` and consumes it (ordered after CREATE SCHEMA).
    const desired = buildFactBase(
      [
        f(publicSchema),
        f(app),
        f(hstore, { schema: "app", _relocatable: true }),
      ],
      [],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    const schemaAt = sqls.findIndex((s) => /CREATE SCHEMA "app"/.test(s));
    const extAt = sqls.findIndex((s) =>
      /CREATE EXTENSION "hstore" SCHEMA "app"/.test(s),
    );
    expect(schemaAt).toBeGreaterThanOrEqual(0);
    expect(extAt).toBeGreaterThan(schemaAt);
  });
});

describe("relocatable is version-derived metadata, never a diffable attribute", () => {
  // CLI-2219: `relocatable` is a pure function of the installed extension
  // VERSION (its control file) — not settable by any DDL. Since `version` is
  // deliberately excluded from the payload, a relocatable flip across versions
  // (wrappers did this) is version churn leaking back in through a side door:
  // the differ emitted a `set relocatable` delta no attribute rule covers, and
  // plan() threw guardrail 3 (a hard 500 on the mgmt-api branch diff).
  const wrappers: StableId = { kind: "extension", name: "wrappers" };

  test("a relocatable flip alone (same schema) plans to zero actions, not guardrail 3", () => {
    const source = buildFactBase(
      [
        f(publicSchema),
        { id: wrappers, payload: extensionPayload("public", false) },
      ],
      [],
    );
    const desired = buildFactBase(
      [
        f(publicSchema),
        { id: wrappers, payload: extensionPayload("public", true) },
      ],
      [],
    );
    expect(plan(source, desired).actions).toEqual([]);
  });

  test("the two control-file variants are content-hash equal (no diff, no drift)", () => {
    expect(contentHash(extensionPayload("public", false))).toBe(
      contentHash(extensionPayload("public", true)),
    );
  });

  test("a schema move of a NON-relocatable extension still routes to replace", () => {
    // guards the plan-time read the flag exists for: replaceWhen must keep
    // seeing it after it leaves the diffable surface.
    const a: StableId = { kind: "schema", name: "a" };
    const b: StableId = { kind: "schema", name: "b" };
    const source = buildFactBase(
      [f(a), f(b), { id: wrappers, payload: extensionPayload("a", false) }],
      [],
    );
    const desired = buildFactBase(
      [f(a), f(b), { id: wrappers, payload: extensionPayload("b", false) }],
      [],
    );
    const sqls = plan(source, desired).actions.map((action) => action.sql);
    expect(sqls).toContain(`DROP EXTENSION "wrappers"`);
    expect(sqls).toContain(`CREATE EXTENSION "wrappers" SCHEMA "b"`);
    expect(sqls).not.toContain(`ALTER EXTENSION "wrappers" SET SCHEMA "b"`);
  });

  test("a schema move of a RELOCATABLE extension still alters in place", () => {
    const a: StableId = { kind: "schema", name: "a" };
    const b: StableId = { kind: "schema", name: "b" };
    const source = buildFactBase(
      [f(a), f(b), { id: wrappers, payload: extensionPayload("a", true) }],
      [],
    );
    const desired = buildFactBase(
      [f(a), f(b), { id: wrappers, payload: extensionPayload("b", true) }],
      [],
    );
    const sqls = plan(source, desired).actions.map((action) => action.sql);
    expect(sqls).toContain(`ALTER EXTENSION "wrappers" SET SCHEMA "b"`);
  });
});
