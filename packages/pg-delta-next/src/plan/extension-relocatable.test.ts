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
import type { StableId } from "../core/stable-id.ts";
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
      [f(publicSchema), f(pgmq, { schema: "pgmq", relocatable: false })],
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
        f(hstore, { schema: "app", relocatable: true }),
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
