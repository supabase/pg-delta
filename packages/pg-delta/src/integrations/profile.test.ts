/**
 * Unit tests for the integration profile (src/integrations/profile.ts).
 * No Docker: the only DB touch is `probeApplierCapability` / pgMajor, mocked.
 *
 * The profile is the single object that owns "what state may the engine manage?"
 * — it resolves policy + capability + baseline ONCE against a source pool and
 * bakes them into plan/prove/apply option bundles, so all three reconstruct the
 * SAME managed view (plan == prove == apply) by construction.
 */
import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { buildFactBase } from "../core/fact.ts";
import { supabasePolicy } from "../policy/supabase.ts";
import type { IntegrationProfile } from "./profile.ts";
import { rawProfile, resolveProfile } from "./profile.ts";
import { supabaseProfile } from "./supabase.ts";

/** A mock pool: capability probe + server_version_num are the only queries. */
function mockPool(opts: {
  superuser?: boolean;
  memberOf?: string[];
  versionNum?: number;
}): Pool {
  return {
    // biome-ignore lint: minimal pg.Pool stand-in for unit tests
    query: async (sql: string) => {
      if (sql.includes("server_version_num")) {
        return { rows: [{ v: opts.versionNum ?? 170004 }] };
      }
      return {
        rows: [
          {
            role: "applier",
            is_superuser: opts.superuser ?? false,
            member_of: opts.memberOf ?? [],
          },
        ],
      };
    },
  } as unknown as Pool;
}

describe("resolveProfile", () => {
  test("rawProfile composes an unrestricted, handler-free view", async () => {
    const ctx = await resolveProfile(mockPool({}), rawProfile);
    expect(ctx.id).toBe("raw");
    expect(ctx.planOptions.policy).toBeUndefined();
    expect(ctx.planOptions.capability).toBeUndefined();
    expect(ctx.planOptions.baseline).toBeUndefined();
    expect(typeof ctx.proveOptions.reextract).toBe("function");
    expect(typeof ctx.applyOptions.reextract).toBe("function");
  });

  test("supabaseProfile carries the Supabase policy into all three bundles", async () => {
    const ctx = await resolveProfile(mockPool({}), supabaseProfile);
    expect(ctx.id).toBe("supabase");
    expect(ctx.planOptions.policy).toBe(supabasePolicy);
    expect(ctx.proveOptions.policy).toBe(supabasePolicy);
    // baseline is unset on the v1 Supabase policy → resolves cleanly to none
    expect(ctx.planOptions.baseline).toBeUndefined();
    expect(ctx.applyOptions.baseline).toBeUndefined();
  });

  test("planOptions carries the profile id so plan() can stamp the artifact", async () => {
    const supa = await resolveProfile(mockPool({}), supabaseProfile);
    expect(supa.planOptions.profile).toEqual({ id: "supabase" });
    const raw = await resolveProfile(mockPool({}), rawProfile);
    expect(raw.planOptions.profile).toEqual({ id: "raw" });
  });

  test("restrictToApplier probes capability and threads it consistently", async () => {
    const ctx = await resolveProfile(
      mockPool({ superuser: false }),
      supabaseProfile,
      {
        restrictToApplier: true,
      },
    );
    expect(ctx.planOptions.capability).toBeDefined();
    expect(ctx.planOptions.capability?.isSuperuser).toBe(false);
    // the SAME capability object is shared with the proof bundle (plan == prove)
    expect(ctx.proveOptions.capability).toBe(ctx.planOptions.capability);
  });

  test("without restrictToApplier, capability stays unrestricted (no probe)", async () => {
    const ctx = await resolveProfile(mockPool({}), supabaseProfile);
    expect(ctx.planOptions.capability).toBeUndefined();
    expect(ctx.proveOptions.capability).toBeUndefined();
  });

  test("an explicit baseline override is threaded into all three bundles", async () => {
    // a caller (e.g. the CLI `--baseline <file>`) can supply a pre-loaded
    // baseline FactBase for a profile with no policy-declared baseline.
    const baseline = buildFactBase(
      [{ id: { kind: "schema", name: "platform" }, payload: {} }],
      [],
    );
    const ctx = await resolveProfile(mockPool({}), rawProfile, { baseline });
    expect(ctx.planOptions.baseline).toBe(baseline);
    expect(ctx.proveOptions.baseline).toBe(baseline);
    expect(ctx.applyOptions.baseline).toBe(baseline);
  });

  test("an explicit baseline override wins over a policy-declared baseline name", async () => {
    // profile whose policy declares a baseline NAME (which would resolve from
    // the committed baselines dir); the explicit override replaces it without
    // touching the dir, so a missing committed snapshot never even matters.
    const override = buildFactBase(
      [{ id: { kind: "schema", name: "x" }, payload: {} }],
      [],
    );
    const profile: IntegrationProfile = {
      id: "p",
      handlers: [],
      policy: {
        id: "pol",
        baseline: "nonexistent-committed-baseline",
        filter: [],
      },
    };
    const ctx = await resolveProfile(mockPool({}), profile, {
      baseline: override,
    });
    expect(ctx.planOptions.baseline).toBe(override);
  });
});
