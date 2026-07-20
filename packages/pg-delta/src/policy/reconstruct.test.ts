/**
 * Guard + pin (V1): the full managed-view composition
 * (`resolveView` → `projectManagementScope`) must live in exactly one module.
 * Call sites that need both steps go through `reconstructManagedView`; bare
 * `resolveView` alone remains allowed (diff / seed paths).
 *
 * Import/call-based per module — not a nested-call grep. schema-export used to
 * compose via an intermediate variable, which a
 * `projectManagementScope(resolveView(` search would miss.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactBase,
} from "../core/fact.ts";
import { encodeId } from "../core/stable-id.ts";
import { resolveView, type Policy } from "./policy.ts";
import { reconstructManagedView } from "./reconstruct.ts";
import { projectManagementScope } from "./view.ts";

const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HELPER_REL = "policy/reconstruct.ts";

function listProductionTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...listProductionTs(path));
      continue;
    }
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    out.push(path);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function mentionsBoth(code: string): boolean {
  return (
    /\bresolveView\b/.test(code) && /\bprojectManagementScope\b/.test(code)
  );
}

/** Full shape pin — rootHash alone omits diagnostics / referenceOnly / source. */
function expectSameFactBase(a: FactBase, b: FactBase): void {
  expect(a.source).toBe(b.source);
  expect(a.rootHash).toBe(b.rootHash);
  expect(a.diagnostics).toEqual(b.diagnostics);
  expect([...a.referenceOnly].sort()).toEqual([...b.referenceOnly].sort());
  const factKey = (f: Fact) => encodeId(f.id);
  const factsA = a
    .facts()
    .slice()
    .sort((x, y) => (factKey(x) < factKey(y) ? -1 : 1));
  const factsB = b
    .facts()
    .slice()
    .sort((x, y) => (factKey(x) < factKey(y) ? -1 : 1));
  expect(factsA).toEqual(factsB);
  const edgeKey = (e: DependencyEdge) =>
    `${encodeId(e.from)}-${e.kind}->${encodeId(e.to)}`;
  expect(
    a.edges.slice().sort((x, y) => (edgeKey(x) < edgeKey(y) ? -1 : 1)),
  ).toEqual(b.edges.slice().sort((x, y) => (edgeKey(x) < edgeKey(y) ? -1 : 1)));
}

describe("reconstructManagedView is the sole full composition site", () => {
  test("no production module outside the helper imports/calls both steps", () => {
    const offenders: string[] = [];
    for (const path of listProductionTs(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, path).replaceAll("\\", "/");
      if (rel === HELPER_REL) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      if (mentionsBoth(code)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("reconstructManagedView — composition pin", () => {
  const tableId = { kind: "table" as const, schema: "app", name: "t" };
  const facts: Fact[] = [
    { id: { kind: "schema", name: "app" }, payload: {} },
    { id: tableId, parent: { kind: "schema", name: "app" }, payload: {} },
    { id: { kind: "role", name: "supabase_admin" }, payload: {} },
    { id: { kind: "role", name: "app_owner" }, payload: {} },
  ];
  const edges: DependencyEdge[] = [
    {
      from: tableId,
      to: { kind: "role", name: "supabase_admin" },
      kind: "owner",
    },
  ];
  // owner-exclusion (Supabase Rule 6 shape). `defaultOwner: "supabase_admin"`
  // is load-bearing for the ORDER pin: database scope prunes that owner edge,
  // so resolveView-after-scope can no longer match `{ owner }` and the table
  // wrongly survives. With `defaultOwner: "app_owner"` the dangling edge is
  // retained and reverse order still excludes — a false green.
  const policy: Policy = {
    id: "owner-exclude",
    filter: [{ match: { owner: "supabase_admin" }, action: "exclude" }],
  };
  const databaseOpts = {
    policy,
    scope: "database" as const,
    defaultOwner: "supabase_admin",
  };

  test("matches resolveView then projectManagementScope (full FactBase shape)", () => {
    const fb = buildFactBase(facts, edges);
    const viaHelper = reconstructManagedView(fb, databaseOpts);
    const viaOpen = projectManagementScope(
      resolveView(fb, databaseOpts.policy),
      databaseOpts.scope,
      { defaultOwner: databaseOpts.defaultOwner },
    );
    expectSameFactBase(viaHelper, viaOpen);
    expect(viaHelper.get(tableId)).toBeUndefined();
  });

  test("reversed scope→resolveView leaves the owner-excluded table (order pin)", () => {
    const fb = buildFactBase(facts, edges);
    const viaHelper = reconstructManagedView(fb, databaseOpts);
    const viaReversed = resolveView(
      projectManagementScope(fb, databaseOpts.scope, {
        defaultOwner: databaseOpts.defaultOwner,
      }),
      databaseOpts.policy,
    );
    // Correct order excludes the system-owned table; reverse order cannot.
    expect(viaHelper.get(tableId)).toBeUndefined();
    expect(viaReversed.get(tableId)).toBeDefined();
    expect(viaHelper.rootHash).not.toBe(viaReversed.rootHash);
  });

  test("default scope is cluster (identity after resolveView)", () => {
    const fb = buildFactBase(facts, edges);
    const viaHelper = reconstructManagedView(fb, { policy });
    const viaResolve = resolveView(fb, policy);
    expectSameFactBase(viaHelper, viaResolve);
    expect(viaHelper.get({ kind: "role", name: "app_owner" })).toBeDefined();
  });
});
