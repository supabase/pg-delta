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

  test("round-trips the additive projection audit", () => {
    const schemaId = { kind: "schema" as const, name: "hidden" };
    const withAudit: Plan = {
      ...samplePlan,
      projectionAudit: {
        entries: [
          {
            delta: {
              verb: "remove",
              fact: { id: schemaId, payload: {} },
            },
            subject: { kind: "fact", id: schemaId },
            suppressions: [
              {
                side: "source",
                stage: "policyScopeRule",
                reasonCode: "policy:test:hidden-schema",
                classification: "suspicious",
              },
            ],
            classification: "suspicious",
          },
        ],
        summary: {
          total: 1,
          suspicious: 1,
          acknowledged: 0,
          baseline: 0,
        },
      },
    };
    expect(parsePlan(serializePlan(withAudit)).projectionAudit).toEqual(
      withAudit.projectionAudit,
    );
  });

  test("accepts a legacy v1 artifact without a projection audit", () => {
    expect(
      parsePlan(serializePlan(samplePlan)).projectionAudit,
    ).toBeUndefined();
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
      parsePlan(`{"formatVersion": 1, "engineVersion": "${ENGINE_VERSION}"}`),
    ).toThrow(/missing actions/);
  });

  test("rejects missing or unknown action data-loss metadata", () => {
    const missing = JSON.parse(serializePlan(samplePlan)) as Record<
      string,
      unknown
    >;
    delete (missing["actions"] as Array<Record<string, unknown>>)[0]![
      "dataLoss"
    ];
    expect(() => parsePlan(JSON.stringify(missing))).toThrow(
      /actions\[0\]\.dataLoss/,
    );

    const unknown = JSON.parse(serializePlan(samplePlan)) as Record<
      string,
      unknown
    >;
    (unknown["actions"] as Array<Record<string, unknown>>)[0]!["dataLoss"] =
      "unknown";
    expect(() => parsePlan(JSON.stringify(unknown))).toThrow(
      /actions\[0\]\.dataLoss/,
    );
  });

  test("strictly validates every required action field and enum", () => {
    const invalid: Array<[field: string, value: unknown]> = [
      ["sql", 1],
      ["verb", "truncate"],
      ["produces", null],
      ["consumes", {}],
      ["destroys", "table:app.t"],
      ["releases", 1],
      ["transactionality", "sometimes"],
      ["lockClass", "rowExclusive"],
      ["newSegmentBefore", "false"],
      ["rewriteRisk", 0],
    ];
    for (const [field, value] of invalid) {
      const artifact = JSON.parse(serializePlan(samplePlan)) as Record<
        string,
        unknown
      >;
      (artifact["actions"] as Array<Record<string, unknown>>)[0]![field] =
        value;
      expect(() => parsePlan(JSON.stringify(artifact)), field).toThrow(
        new RegExp(`actions\\[0\\]\\.${field}`),
      );
    }
  });

  test("strictly validates stable IDs in action metadata", () => {
    for (const badId of [
      { kind: "unknown", name: "t" },
      { kind: "table", name: "t" },
      { kind: "function", schema: "app", name: "f", args: "integer" },
    ]) {
      const artifact = JSON.parse(serializePlan(samplePlan)) as Record<
        string,
        unknown
      >;
      (artifact["actions"] as Array<Record<string, unknown>>)[0]!["destroys"] =
        [badId];
      expect(() => parsePlan(JSON.stringify(artifact))).toThrow(
        /actions\[0\]\.destroys\[0\]/,
      );
    }
  });
});
