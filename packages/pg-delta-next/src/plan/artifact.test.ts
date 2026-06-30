/** Plan artifact v1: lossless round-trip + version refusals (stage 6). */
import { describe, expect, test } from "bun:test";
import { parsePlan, serializePlan } from "./artifact.ts";
import { ENGINE_VERSION, type Plan } from "./plan.ts";

const samplePlan: Plan = {
  formatVersion: 1,
  engineVersion: ENGINE_VERSION,
  source: { fingerprint: "a".repeat(64) },
  target: { fingerprint: "b".repeat(64) },
  preamble: [{ name: "check_function_bodies", value: "off" }],
  filteredDeltas: [],
  renameCandidates: [],
  deltas: [
    {
      verb: "add",
      fact: {
        id: { kind: "schema", name: "app" },
        payload: { owner: "test", big: 9223372036854775807n },
      },
    },
  ],
  actions: [
    {
      sql: 'CREATE SCHEMA "app" AUTHORIZATION "test"',
      verb: "create",
      produces: [{ kind: "schema", name: "app" }],
      consumes: [{ kind: "role", name: "test" }],
      destroys: [],
      releases: [],
      transactionality: "transactional",
      lockClass: "none",
      newSegmentBefore: false,
      dataLoss: "none",
      rewriteRisk: false,
    },
  ],
  safetyReport: {
    destructiveActions: 0,
    rewriteRiskActions: 0,
    nonTransactionalActions: 0,
    lockClasses: { none: 1 },
  },
};

describe("plan artifact v1", () => {
  test("round-trips losslessly, including bigint payload values", () => {
    const parsed = parsePlan(serializePlan(samplePlan));
    expect(parsed).toEqual(samplePlan);
    const delta = parsed.deltas[0];
    if (delta?.verb !== "add") throw new Error("expected add delta");
    expect(typeof delta.fact.payload["big"]).toBe("bigint");
  });

  test("round-trips an inlined applier capability (follow-up 2)", () => {
    const withCapability: Plan = {
      ...samplePlan,
      capability: {
        role: "app_owner",
        isSuperuser: false,
        memberOf: ["app_owner", "readers"],
      },
    };
    const parsed = parsePlan(serializePlan(withCapability));
    expect(parsed.capability).toEqual({
      role: "app_owner",
      isSuperuser: false,
      memberOf: ["app_owner", "readers"],
    });
  });

  test("round-trips the stamped integration profile id (P2 follow-up)", () => {
    const withProfile: Plan = { ...samplePlan, profile: { id: "supabase" } };
    const parsed = parsePlan(serializePlan(withProfile));
    expect(parsed.profile).toEqual({ id: "supabase" });
  });

  test("a profile-less plan (direct library plan()) parses (profile undefined)", () => {
    const parsed = parsePlan(serializePlan(samplePlan));
    expect(parsed.profile).toBeUndefined();
  });

  test("round-trips the stamped redaction mode so apply/prove re-extract identically", () => {
    // a plan produced with --unsafe-show-secrets fingerprints over unredacted
    // secrets; the artifact must carry redactSecrets:false so apply/prove
    // re-extract the target the same way (otherwise the fingerprint gate fails).
    const unsafe: Plan = { ...samplePlan, redactSecrets: false };
    expect(parsePlan(serializePlan(unsafe)).redactSecrets).toBe(false);
    expect(parsePlan(serializePlan(samplePlan)).redactSecrets).toBeUndefined();
  });

  test("rejects unknown formatVersion", () => {
    const mangled = serializePlan(samplePlan).replace(
      '"formatVersion": 1',
      '"formatVersion": 2',
    );
    expect(() => parsePlan(mangled)).toThrow(/unsupported formatVersion 2/);
  });

  test("rejects a foreign engineVersion", () => {
    const mangled = serializePlan(samplePlan).replace(
      `"engineVersion": "${ENGINE_VERSION}"`,
      '"engineVersion": "99.0.0"',
    );
    expect(() => parsePlan(mangled)).toThrow(/produced by engine 99\.0\.0/);
  });

  test("rejects non-JSON and structurally broken artifacts", () => {
    expect(() => parsePlan("not json")).toThrow(/not valid JSON/);
    expect(() =>
      parsePlan('{"formatVersion": 1, "engineVersion": "0.1.0"}'),
    ).toThrow(/missing actions/);
  });
});
