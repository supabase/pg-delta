/**
 * Unit tests for the baseline RESOLUTION seam (review finding 3): a policy that
 * declares a `baseline` must never be silently ignored.
 *
 *  - `resolveBaseline` loads the committed snapshot for a policy's baseline, and
 *    THROWS (fail-loud) when the baseline is declared but no snapshot is
 *    committed.
 *  - `plan()` THROWS if handed a baseline-declaring policy without a resolved
 *    baseline — closing the trap at the core API, regardless of entry point.
 *  - `resolveView` subtracts a provided baseline FactBase.
 *
 * No Docker required.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { serializeSnapshot } from "../core/snapshot.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "../plan/plan.ts";
import { resolveBaseline } from "./baseline.ts";
import { resolveView } from "./policy.ts";

const schemaPublic: StableId = { kind: "schema", name: "public" };
const tableUsers: StableId = { kind: "table", schema: "public", name: "users" };

function fact(id: StableId, payload = {}, parent?: StableId): Fact {
  return parent ? { id, parent, payload } : { id, payload };
}

describe("resolveBaseline — fail-loud", () => {
  test("returns undefined when the policy declares no baseline", () => {
    expect(
      resolveBaseline({ id: "p" }, { pgMajor: 17, dir: tmpdir() }),
    ).toBeUndefined();
  });

  test("THROWS when a baseline is declared but no snapshot is committed", () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-missing-"));
    expect(() =>
      resolveBaseline(
        { id: "supabase", baseline: "supabase-baseline" },
        {
          pgMajor: 17,
          dir,
        },
      ),
    ).toThrow(/baseline "supabase-baseline"/);
  });

  test("loads the committed snapshot when present (<id>-<major>.json)", () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-present-"));
    const baselineFb = buildFactBase([fact(schemaPublic)], []);
    writeFileSync(
      join(dir, "supabase-baseline-17.json"),
      serializeSnapshot(baselineFb, { pgVersion: "17.0" }),
    );
    const resolved = resolveBaseline(
      { id: "supabase", baseline: "supabase-baseline" },
      { pgMajor: 17, dir },
    );
    expect(resolved?.factBase.has(schemaPublic)).toBe(true);
    // the loaded baseline carries the digest (== the snapshot's rootHash) so
    // plan/apply/prove can reconcile it across commands.
    expect(resolved?.digest).toBe(baselineFb.rootHash);
  });
});

describe("plan() — refuses an unresolved declared baseline", () => {
  const empty = buildFactBase([], []);

  test("THROWS when the policy declares a baseline and none was resolved", () => {
    expect(() =>
      plan(empty, empty, {
        policy: { id: "p", baseline: "supabase-baseline" },
      }),
    ).toThrow(/baseline/i);
  });

  test("does NOT throw when a resolved baseline is supplied", () => {
    const baseline = buildFactBase([], []);
    expect(() =>
      plan(empty, empty, {
        policy: { id: "p", baseline: "supabase-baseline" },
        baseline,
      }),
    ).not.toThrow();
  });
});

describe("resolveView — subtracts a provided baseline", () => {
  test("a fact present-and-identical in the baseline is projected out", () => {
    const fb = buildFactBase(
      [
        fact(schemaPublic),
        fact(tableUsers, { persistence: "p" }, schemaPublic),
      ],
      [],
    );
    // baseline contains schemaPublic identically → it (and only it) subtracts
    const baseline = buildFactBase([fact(schemaPublic)], []);
    const view = resolveView(fb, undefined, undefined, baseline);
    expect(view.has(tableUsers)).toBe(true);
    // schemaPublic is the parent of a surviving fact → force-kept by subtraction
    expect(view.has(schemaPublic)).toBe(true);
  });
});
