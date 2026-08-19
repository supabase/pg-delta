/**
 * Plan-time vault_presence diagnostics (CLI-1434). Synthetic fact bases —
 * no Docker. "In use" is a depends-edge onto a vault member, never a
 * SELECT from vault.secrets.
 */
import { describe, expect, test } from "bun:test";
import { VAULT_PRESENCE } from "../core/diagnostic.ts";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { hasBlockingDiagnostics } from "../frontends/diagnostics.ts";
import { classifyPlanHazards } from "./hazards.ts";
import { plan } from "./plan.ts";

const publicSchema: StableId = { kind: "schema", name: "public" };
const vaultExt: StableId = { kind: "extension", name: "supabase_vault" };
const vaultSecrets: StableId = {
  kind: "table",
  schema: "vault",
  name: "secrets",
};
const decrypted: StableId = {
  kind: "view",
  schema: "vault",
  name: "decrypted_secrets",
};
const userFn: StableId = {
  kind: "function",
  schema: "public",
  name: "use_secret",
  args: [],
};

const f = (id: StableId, payload: Fact["payload"] = {}): Fact => ({
  id,
  payload,
});

const vaultFact = f(vaultExt, { schema: "vault", relocatable: false });
const userFnFact = f(userFn, {
  def: "CREATE FUNCTION public.use_secret() RETURNS text LANGUAGE sql AS $$ SELECT 1 $$",
});

function memberEdges(): DependencyEdge[] {
  return [
    { from: vaultSecrets, to: vaultExt, kind: "memberOfExtension" },
    { from: decrypted, to: vaultExt, kind: "memberOfExtension" },
  ];
}

describe("vault presence plan diagnostics", () => {
  test("case 2: CREATE EXTENSION supabase_vault with no dependents is silent", () => {
    const source = buildFactBase([f(publicSchema)], []);
    const desired = buildFactBase(
      [f(publicSchema), vaultFact, f(vaultSecrets), f(decrypted)],
      memberEdges(),
    );
    const thePlan = plan(source, desired);
    expect(
      thePlan.actions.some((a) =>
        /CREATE EXTENSION "supabase_vault"/.test(a.sql),
      ),
    ).toBe(true);
    expect(thePlan.diagnostics ?? []).toEqual([]);
  });

  test("case 3: CREATE plus a kept depends-edge emits vault_presence warning", () => {
    const source = buildFactBase([f(publicSchema)], []);
    const desired = buildFactBase(
      [f(publicSchema), vaultFact, f(vaultSecrets), f(decrypted), userFnFact],
      [...memberEdges(), { from: userFn, to: decrypted, kind: "depends" }],
    );
    const thePlan = plan(source, desired);
    expect(
      thePlan.actions.some((a) =>
        /CREATE EXTENSION "supabase_vault"/.test(a.sql),
      ),
    ).toBe(true);
    const diags = thePlan.diagnostics ?? [];
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe(VAULT_PRESENCE);
    expect(diags[0]!.severity).toBe("warning");
    expect(diags[0]!.subject).toEqual(vaultExt);
    expect(diags[0]!.message).toMatch(
      /secret values and keys are not part of the schema/,
    );
    expect(diags[0]!.message).toMatch(/Vault section of the dashboard/);
    expect(diags[0]!.message).toMatch(/management API/);
    expect(hasBlockingDiagnostics(diags)).toBe(false);
    expect(hasBlockingDiagnostics(diags, { strictCoverage: true })).toBe(true);
  });

  test("case 4: DROP EXTENSION supabase_vault is destructive and warns", () => {
    const source = buildFactBase(
      [f(publicSchema), vaultFact, f(vaultSecrets), f(decrypted)],
      memberEdges(),
    );
    const desired = buildFactBase([f(publicSchema)], []);
    const thePlan = plan(source, desired);
    const drop = thePlan.actions.find((a) =>
      /DROP EXTENSION "supabase_vault"/.test(a.sql),
    );
    expect(drop).toBeDefined();
    expect(drop!.dataLoss).toBe("destructive");
    expect(classifyPlanHazards(thePlan).kinds).toContain("data_loss");
    const diags = thePlan.diagnostics ?? [];
    expect(diags.some((d) => d.code === VAULT_PRESENCE)).toBe(true);
    expect(diags[0]!.message).toMatch(/vault\.secrets/);
  });

  test("a depends-edge onto the extension itself (normalized proc/type) still warns", () => {
    // extract/dependencies.ts COALESCE(extm.id, proc/typ.id) folds a
    // pg_proc/pg_type member endpoint to extension:supabase_vault. A user
    // column typed with a vault type, or a function depending on a vault
    // proc, therefore lands here — not on the member id.
    const source = buildFactBase([f(publicSchema)], []);
    const desired = buildFactBase(
      [f(publicSchema), vaultFact, f(vaultSecrets), f(decrypted), userFnFact],
      [...memberEdges(), { from: userFn, to: vaultExt, kind: "depends" }],
    );
    const diags = plan(source, desired).diagnostics ?? [];
    expect(diags.some((d) => d.code === VAULT_PRESENCE)).toBe(true);
  });

  test("a depends-edge onto a member COLUMN (closure descendant) still warns", () => {
    const secretCol: StableId = {
      kind: "column",
      schema: "vault",
      table: "secrets",
      name: "name",
    };
    const source = buildFactBase([f(publicSchema)], []);
    const desired = buildFactBase(
      [
        f(publicSchema),
        vaultFact,
        f(vaultSecrets),
        { id: secretCol, parent: vaultSecrets, payload: {} },
        userFnFact,
      ],
      [
        { from: vaultSecrets, to: vaultExt, kind: "memberOfExtension" },
        { from: userFn, to: secretCol, kind: "depends" },
      ],
    );
    const diags = plan(source, desired).diagnostics ?? [];
    expect(diags.some((d) => d.code === VAULT_PRESENCE)).toBe(true);
  });

  test("case 5: vault on both sides with the same dependents is silent", () => {
    const facts = [
      f(publicSchema),
      vaultFact,
      f(vaultSecrets),
      f(decrypted),
      userFnFact,
    ];
    const edges: DependencyEdge[] = [
      ...memberEdges(),
      { from: userFn, to: decrypted, kind: "depends" },
    ];
    const thePlan = plan(
      buildFactBase(facts, edges),
      buildFactBase(facts, edges),
    );
    expect(
      thePlan.actions.some((a) => /EXTENSION "supabase_vault"/.test(a.sql)),
    ).toBe(false);
    expect(thePlan.diagnostics ?? []).toEqual([]);
  });
});
