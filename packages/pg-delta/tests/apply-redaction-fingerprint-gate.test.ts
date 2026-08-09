/**
 * Item 16 (issue #333): `apply()`'s fingerprint gate (apply.ts ~line 145)
 * re-extracts the target with the DEFAULT redaction mode
 * (`extract(target)` → `redactSecrets: true`), ignoring `Plan.redactSecrets` —
 * even though the plan carries it PRECISELY so apply/prove reconstruct the
 * SAME view the plan was fingerprinted from (plan.ts's `redactSecrets` doc
 * comment). A plan built from `extract({ redactSecrets: false })` state is
 * therefore spuriously rejected: the gate's re-extract sees the
 * `__OPTION_PASSWORD__` placeholder where the plan's fingerprint was computed
 * over the real secret, so the hashes never match — even for a NO-OP plan
 * (source === desired, zero actions).
 *
 * The CLI (`src/cli/commands/apply.ts`) already works around this by building
 * its own `reextract: (p) => ctx.extract(p, { redactSecrets })` option, so this
 * only bites a DIRECT library caller of `apply()`/`provePlan()` that does not
 * replicate that workaround — exactly the shape of a plan built via
 * `plan(source, desired, { redactSecrets: false })` and applied with no custom
 * `reextract`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

const SECRET = "apply-gate-secret";
const SETUP_SQL = `CREATE FOREIGN DATA WRAPPER redact16_fdw OPTIONS (password '${SECRET}');`;

describe("item 16: apply() honors Plan.redactSecrets in the fingerprint gate", () => {
  test("a no-op plan built with redactSecrets:false applies cleanly (no spurious fingerprint mismatch)", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("apply_gate_redact");
    dbs.push(target);
    await target.pool.query(SETUP_SQL);

    const state = await extract(target.pool, { redactSecrets: false });
    const thePlan = plan(state.factBase, state.factBase, {
      redactSecrets: false,
    });
    expect(thePlan.actions.length).toBe(0);
    expect(thePlan.redactSecrets).toBe(false);

    // GREEN: applies (0 actions, trivially "applied"). RED (default re-extract
    // ignores thePlan.redactSecrets): rejects with `apply: fingerprint gate
    // failed — the target's resolved state (…) is not the plan's source (…)`.
    const report = await apply(thePlan, target.pool);
    expect(report.status).toBe("applied");
  }, 60_000);

  test("provePlan's fingerprint reconstruction also honors Plan.redactSecrets", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("prove_gate_redact_src");
    dbs.push(source);
    await source.pool.query(SETUP_SQL);

    const state = await extract(source.pool, { redactSecrets: false });
    const thePlan = plan(state.factBase, state.factBase, {
      redactSecrets: false,
    });
    expect(thePlan.actions.length).toBe(0);

    const clone = await source.clone();
    dbs.push(clone);
    // GREEN: proves cleanly (ok: true). RED: provePlan's internal apply() call
    // passes fingerprintGate:false (so it does not throw here), but the
    // POST-apply re-extract at prove.ts's `(options.reextract ?? extract)
    // (clonePool)` also ignores thePlan.redactSecrets — the proven clone comes
    // back placeholder-redacted while `desired` (passed in already extracted
    // with redactSecrets:false) still carries the real secret, so the diff
    // reports a spurious drift delta and `ok` is false even though nothing
    // actually diverged.
    const verdict = await provePlan(thePlan, clone.pool, state.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.ok).toBe(true);
  }, 60_000);
});
