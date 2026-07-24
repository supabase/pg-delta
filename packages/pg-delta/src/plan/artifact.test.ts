/** Plan artifact v1: lossless round-trip + version refusals (stage 6). */
import { describe, expect, test } from "bun:test";
import { parsePlan, serializePlan } from "./artifact.ts";
import { ENGINE_VERSION, type Plan } from "./plan.ts";
import { normalizeProjectionAudit } from "../policy/reconstruct.ts";

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

  test("round-trips an opaque PostgreSQL source-lineage stamp", () => {
    const stamped: Plan = {
      ...samplePlan,
      source: {
        ...samplePlan.source,
        endpointHash: "c".repeat(64),
        identity: {
          scheme: "pg-system-identifier-v1",
          lineageHash: "d".repeat(64),
          databaseHash: "e".repeat(64),
        },
      },
    };

    expect(parsePlan(serializePlan(stamped)).source).toEqual(stamped.source);
  });

  test("rejects malformed source fingerprints, endpoint hashes, and identity stamps", () => {
    const cases: Array<
      [path: string, mutate: (value: Record<string, unknown>) => void]
    > = [
      ["source.fingerprint", (value) => (value["fingerprint"] = "short")],
      [
        "target.fingerprint",
        (value) => (value["fingerprint"] = "z".repeat(64)),
      ],
      [
        "source.endpointHash",
        (value) => (value["endpointHash"] = "g".repeat(64)),
      ],
      [
        "source.identity.scheme",
        (value) =>
          ((value["identity"] as Record<string, unknown>)["scheme"] = "v2"),
      ],
      [
        "source.identity.lineageHash",
        (value) =>
          ((value["identity"] as Record<string, unknown>)["lineageHash"] = ""),
      ],
      [
        "source.identity.databaseHash",
        (value) =>
          delete (value["identity"] as Record<string, unknown>)["databaseHash"],
      ],
      [
        "source.identity.extra",
        (value) =>
          ((value["identity"] as Record<string, unknown>)["extra"] = true),
      ],
    ];

    for (const [path, mutate] of cases) {
      const artifact = JSON.parse(
        serializePlan({
          ...samplePlan,
          source: {
            ...samplePlan.source,
            endpointHash: "c".repeat(64),
            identity: {
              scheme: "pg-system-identifier-v1",
              lineageHash: "d".repeat(64),
              databaseHash: "e".repeat(64),
            },
          },
        } as Plan),
      ) as Record<string, unknown>;
      const target = path.startsWith("target.")
        ? (artifact["target"] as Record<string, unknown>)
        : (artifact["source"] as Record<string, unknown>);
      mutate(target);
      expect(() => parsePlan(JSON.stringify(artifact)), path).toThrow(
        new RegExp(path.replace(".", "\\.")),
      );
    }
  });

  test("rejects null and malformed projection audits", () => {
    for (const projectionAudit of [
      null,
      { entries: null, summary: {} },
      {
        entries: [{ classification: "suspicious", suppressions: [] }],
        summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
      },
    ]) {
      expect(() =>
        parsePlan(
          serializePlan({ ...samplePlan, projectionAudit } as unknown as Plan),
        ),
      ).toThrow(/plan artifact: invalid projectionAudit/);
    }
  });

  test("rejects malformed projection-audit entries by validation family", () => {
    const id = { kind: "table" as const, schema: "app", name: "hidden" };
    const otherId = { kind: "table" as const, schema: "app", name: "other" };
    const validEntry = {
      delta: { verb: "set", id, attr: "persistence", from: "p", to: "u" },
      subject: { kind: "fact", id },
      suppressions: [
        {
          side: "desired",
          stage: "policyScopeRule",
          reasonCode: "policy:test:hidden-table",
          classification: "suspicious",
        },
      ],
      classification: "suspicious",
    };
    const edge = {
      from: id,
      to: { kind: "schema" as const, name: "app" },
      kind: "depends" as const,
    };
    const cases: Array<{ name: string; entry: unknown; path: RegExp }> = [
      {
        name: "invalid suppression side",
        entry: {
          ...validEntry,
          suppressions: [{ ...validEntry.suppressions[0], side: "both" }],
        },
        path: /suppressions\[0\]\.side/,
      },
      {
        name: "invalid suppression stage",
        entry: {
          ...validEntry,
          suppressions: [{ ...validEntry.suppressions[0], stage: "unknown" }],
        },
        path: /suppressions\[0\]\.stage/,
      },
      {
        name: "invalid entry classification",
        entry: { ...validEntry, classification: "unknown" },
        path: /entries\[0\]\.classification/,
      },
      {
        name: "invalid suppression classification",
        entry: {
          ...validEntry,
          suppressions: [
            { ...validEntry.suppressions[0], classification: "unknown" },
          ],
        },
        path: /suppressions\[0\]\.classification/,
      },
      {
        name: "subject does not match delta",
        entry: { ...validEntry, subject: { kind: "fact", id: otherId } },
        path: /entries\[0\]\.subject/,
      },
      {
        name: "invalid stable id",
        entry: {
          ...validEntry,
          delta: {
            ...validEntry.delta,
            id: { kind: "table", schema: "app" },
          },
        },
        path: /entries\[0\]\.delta\.id/,
      },
      {
        name: "stable id with hidden extra key",
        entry: {
          ...validEntry,
          delta: {
            ...validEntry.delta,
            id: { ...id, _hidden: "must not be ignored" },
          },
        },
        path: /entries\[0\]\.delta\.id/,
      },
      {
        name: "invalid edge kind",
        entry: {
          ...validEntry,
          delta: { verb: "link", edge: { ...edge, kind: "contains" } },
          subject: { kind: "edge", edge: { ...edge, kind: "contains" } },
        },
        path: /entries\[0\]\.delta\.edge\.kind/,
      },
      {
        name: "set delta with neither endpoint serialized",
        entry: {
          ...validEntry,
          delta: { verb: "set", id, attr: "persistence" },
        },
        path: /entries\[0\]\.delta\.(from|to)/,
      },
      {
        name: "malformed link delta",
        entry: {
          ...validEntry,
          delta: { verb: "link", edge: { from: id, kind: "depends" } },
        },
        path: /entries\[0\]\.delta\.edge\.to/,
      },
      {
        name: "empty suppressions",
        entry: { ...validEntry, suppressions: [] },
        path: /entries\[0\]\.suppressions/,
      },
    ];

    for (const testCase of cases) {
      expect(
        () =>
          parsePlan(
            serializePlan({
              ...samplePlan,
              projectionAudit: {
                entries: [testCase.entry],
                summary: {
                  total: 1,
                  suspicious: 1,
                  acknowledged: 0,
                  baseline: 0,
                },
              },
            } as unknown as Plan),
          ),
        testCase.name,
      ).toThrow(testCase.path);
    }
  });

  test("accepts a set audit delta with one serialized endpoint", () => {
    const id = { kind: "table" as const, schema: "app", name: "hidden" };
    const parsed = parsePlan(
      serializePlan({
        ...samplePlan,
        projectionAudit: {
          entries: [
            {
              delta: {
                verb: "set",
                id,
                attr: "new_attribute",
                from: undefined,
                to: "value",
              },
              subject: { kind: "fact", id },
              suppressions: [
                {
                  side: "desired",
                  stage: "policyScopeRule",
                  reasonCode: "policy:test:hidden-table",
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
      }),
    );

    expect(parsed.projectionAudit?.entries[0]?.delta as unknown).toEqual({
      verb: "set",
      id,
      attr: "new_attribute",
      to: "value",
    });
  });

  test("validates audit payload values recursively without rejecting payload metadata", () => {
    const id = { kind: "table" as const, schema: "app", name: "hidden" };
    const valid = serializePlan({
      ...samplePlan,
      projectionAudit: {
        entries: [
          {
            delta: {
              verb: "add",
              fact: {
                id,
                payload: {
                  _metadata: { nested: ["ok", 1, true, null, 2n] },
                },
              },
            },
            subject: { kind: "fact", id },
            suppressions: [
              {
                side: "desired",
                stage: "policyScopeRule",
                reasonCode: "policy:test:hidden-table",
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
    });

    expect(parsePlan(valid).projectionAudit?.entries).toHaveLength(1);
    expect(() =>
      parsePlan(valid.replace('"nested": [', '"bad": 1e400, "nested": [')),
    ).toThrow(/projectionAudit.*delta\.fact\.payload\._metadata\.bad/);
  });

  test("validates direct-API StableIds without ignoring extra undefined keys", () => {
    const table = { kind: "table" as const, schema: "app", name: "hidden" };
    const acl = {
      kind: "acl" as const,
      target: {
        kind: "acl" as const,
        target: table,
        grantee: "nested_reader",
        column: undefined,
      },
      grantee: "reader",
      column: undefined,
    };
    const makeAudit = (id: unknown) => ({
      entries: [
        {
          delta: { verb: "add", fact: { id, payload: {} } },
          subject: { kind: "fact", id },
          suppressions: [
            {
              side: "desired",
              stage: "policyScopeRule",
              reasonCode: "policy:test:hidden",
              classification: "suspicious",
            },
          ],
          classification: "suspicious",
        },
      ],
      summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
    });

    expect(normalizeProjectionAudit(makeAudit(acl)).entries).toHaveLength(1);
    expect(() =>
      normalizeProjectionAudit(makeAudit({ ...table, extra: undefined })),
    ).toThrow(/entries\[0\]\.delta\.fact\.id/);
  });

  test("accepts only JSON-like record containers in direct-API payloads", () => {
    const id = { kind: "table" as const, schema: "app", name: "hidden" };
    const makeAudit = (payloadValue: unknown) => ({
      entries: [
        {
          delta: {
            verb: "add",
            fact: { id, payload: { _metadata: payloadValue } },
          },
          subject: { kind: "fact", id },
          suppressions: [
            {
              side: "desired",
              stage: "policyScopeRule",
              reasonCode: "policy:test:hidden-table",
              classification: "suspicious",
            },
          ],
          classification: "suspicious",
        },
      ],
      summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
    });
    const nullPrototype = Object.assign(Object.create(null) as object, {
      nested: "ok",
      omitted: undefined,
    });

    expect(
      normalizeProjectionAudit(
        makeAudit({ nested: { allowed: undefined }, nullPrototype }),
      ).entries,
    ).toHaveLength(1);
    for (const value of [
      new Date(),
      new Map([["key", "value"]]),
      new Set(["value"]),
      new (class PayloadClass {
        value = "not plain";
      })(),
    ]) {
      expect(() => normalizeProjectionAudit(makeAudit(value))).toThrow(
        /entries\[0\]\.delta\.fact\.payload\._metadata/,
      );
    }
    expect(() =>
      normalizeProjectionAudit(makeAudit(["ok", undefined])),
    ).toThrow(/entries\[0\]\.delta\.fact\.payload\._metadata\[1\]/);
  });

  test("accepts only plain root payload records for add and remove deltas", () => {
    const id = { kind: "table" as const, schema: "app", name: "hidden" };
    const makeAudit = (verb: "add" | "remove", payload: unknown) => ({
      entries: [
        {
          delta: { verb, fact: { id, payload } },
          subject: { kind: "fact", id },
          suppressions: [
            {
              side: "desired",
              stage: "policyScopeRule",
              reasonCode: "policy:test:hidden-table",
              classification: "suspicious",
            },
          ],
          classification: "suspicious",
        },
      ],
      summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
    });
    const nullPrototype = Object.assign(Object.create(null) as object, {
      nested: { allowed: undefined },
    });
    const invalidPayloads = [
      new Date(),
      new Map([["key", "value"]]),
      new Set(["value"]),
      new (class PayloadClass {
        value = "not plain";
      })(),
    ];

    for (const verb of ["add", "remove"] as const) {
      expect(
        normalizeProjectionAudit(makeAudit(verb, nullPrototype)).entries,
      ).toHaveLength(1);
      for (const payload of invalidPayloads) {
        expect(() =>
          normalizeProjectionAudit(makeAudit(verb, payload)),
        ).toThrow(/entries\[0\]\.delta\.fact\.payload/);
      }
    }
  });

  test("rejects a non-finite projection-audit set endpoint", () => {
    const id = { kind: "table" as const, schema: "app", name: "hidden" };
    const json = serializePlan({
      ...samplePlan,
      projectionAudit: {
        entries: [
          {
            delta: { verb: "set", id, attr: "setting", from: 1, to: 2 },
            subject: { kind: "fact", id },
            suppressions: [
              {
                side: "desired",
                stage: "policyScopeRule",
                reasonCode: "policy:test:hidden-table",
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
    }).replace('"to": 2', '"to": 1e400');

    expect(() => parsePlan(json)).toThrow(/projectionAudit.*delta\.to/);
  });

  test("recomputes an inconsistent projection-audit summary from entries", () => {
    const schemaId = { kind: "schema" as const, name: "hidden" };
    const parsed = parsePlan(
      serializePlan({
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
            total: 0,
            suspicious: 0,
            acknowledged: 0,
            baseline: 0,
          },
        },
      }),
    );

    expect(parsed.projectionAudit?.summary).toEqual({
      total: 1,
      suspicious: 1,
      acknowledged: 0,
      baseline: 0,
    });
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
