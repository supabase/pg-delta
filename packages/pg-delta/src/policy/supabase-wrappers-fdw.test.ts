/**
 * CLI-1470: a FOREIGN DATA WRAPPER provisioned through the Supabase Wrappers
 * product (`CREATE FOREIGN DATA WRAPPER … HANDLER extensions.wasm_fdw_handler`)
 * is platform infrastructure, but on Cloud it ends up owned by `postgres` —
 * supautils elevates the privileged role to create it, then reassigns
 * ownership back (verified empirically on a real project, 2026-08-10:
 * `fdwowner = postgres`). The system-role owner rule therefore never catches
 * it, and the wrapper (plus its server / foreign-table / user-mapping
 * descendants via the managed-view cascade) leaked into plans as
 * superuser-only `CREATE FOREIGN DATA WRAPPER` DDL.
 *
 * The structural signal is provenance, not the owner: the wrapper's handler /
 * validator functions are members of the `wrappers` extension, so pg_depend
 * resolution gives the FDW fact a `depends` edge to the extension fact. The
 * policy excludes exactly that shape. A user FDW whose handler is a hand-rolled
 * function keeps round-tripping. Pure policy level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { resolveView } from "./policy.ts";
import { supabasePolicy } from "./supabase.ts";

const wrappersExtId: StableId = { kind: "extension", name: "wrappers" };
const wasmFdwId: StableId = { kind: "fdw", name: "clerk_oauth" };
const wasmServerId: StableId = { kind: "server", name: "clerk_server" };
const userFdwId: StableId = { kind: "fdw", name: "selfmade" };
const userHandlerId: StableId = {
  kind: "function",
  schema: "public",
  name: "my_fdw_handler",
  args: [],
};
const postgresRoleId: StableId = { kind: "role", name: "postgres" };

function wrapperWorld(): { facts: Fact[]; edges: DependencyEdge[] } {
  const facts: Fact[] = [
    { id: postgresRoleId, payload: {} },
    {
      id: wrappersExtId,
      payload: { schema: "extensions", _relocatable: true },
    },
    {
      id: wasmFdwId,
      payload: {
        handler: "extensions.wasm_fdw_handler",
        validator: "extensions.wasm_fdw_validator",
        options: [],
      },
    },
    {
      id: wasmServerId,
      parent: wasmFdwId,
      payload: { fdw: "clerk_oauth", type: null, version: null, options: [] },
    },
    { id: { kind: "schema", name: "public" }, payload: {} },
    {
      id: userHandlerId,
      parent: { kind: "schema", name: "public" },
      payload: {},
    },
    {
      id: userFdwId,
      payload: {
        handler: "public.my_fdw_handler",
        validator: null,
        options: [],
      },
    },
  ];
  const edges: DependencyEdge[] = [
    // handler/validator are extension members, so pg_depend endpoint
    // resolution collapses both edges onto the extension fact (extm branch).
    { from: wasmFdwId, to: wrappersExtId, kind: "depends" },
    { from: wasmFdwId, to: postgresRoleId, kind: "owner" },
    { from: wasmServerId, to: postgresRoleId, kind: "owner" },
    { from: userFdwId, to: userHandlerId, kind: "depends" },
    { from: userFdwId, to: postgresRoleId, kind: "owner" },
  ];
  return { facts, edges };
}

describe("supabase policy — wrappers-extension FDWs (CLI-1470)", () => {
  test("projects out a postgres-owned FDW whose handler comes from the wrappers extension", () => {
    const { facts, edges } = wrapperWorld();
    const view = resolveView(buildFactBase(facts, edges), supabasePolicy);
    // platform-provisioned (Wrappers dashboard) → invisible, never created/dropped
    expect(view.get(wasmFdwId)).toBeUndefined();
    // its server cascades out with it (managed-view descendant pruning)
    expect(view.get(wasmServerId)).toBeUndefined();
  });

  test("keeps a user FDW whose handler is a hand-rolled function", () => {
    const { facts, edges } = wrapperWorld();
    const view = resolveView(buildFactBase(facts, edges), supabasePolicy);
    expect(view.get(userFdwId)).toBeDefined();
  });
});
