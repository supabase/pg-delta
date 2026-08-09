import { describe, expect, test } from "bun:test";
import { plan } from "../plan/plan.ts";
import { USER_MAPPING_UNREADABLE } from "./diagnostic.ts";
import { buildFactBase, type Fact } from "./fact.ts";
import { deserializeSnapshot, serializeSnapshot } from "./snapshot.ts";
import type { StableId } from "./stable-id.ts";

const fb = buildFactBase(
  [
    { id: { kind: "schema", name: "public" }, payload: {} },
    {
      id: { kind: "table", schema: "public", name: "t" },
      parent: { kind: "schema", name: "public" },
      payload: { persistence: "p" },
    },
    { id: { kind: "role", name: "r" }, payload: { login: true } },
  ],
  [
    {
      from: { kind: "table", schema: "public", name: "t" },
      to: { kind: "role", name: "r" },
      kind: "owner",
    },
  ],
);

describe("snapshot", () => {
  test("round-trips hash-identically", () => {
    const json = serializeSnapshot(fb, { pgVersion: "17.6" });
    const restored = deserializeSnapshot(json);
    expect(restored.factBase.rootHash).toBe(fb.rootHash);
    expect(restored.pgVersion).toBe("17.6");
    expect(restored.factBase.edges).toHaveLength(1);
  });

  test("carries formatVersion 1 and rejects unknown versions", () => {
    const json = serializeSnapshot(fb, { pgVersion: "17.6" });
    expect(JSON.parse(json).formatVersion).toBe(1);
    const tampered = JSON.stringify({ ...JSON.parse(json), formatVersion: 99 });
    expect(() => deserializeSnapshot(tampered)).toThrow(/format/i);
  });

  test("records the redaction mode so drift can re-extract identically", () => {
    // metadata only — it must round-trip but never move the digest (an
    // --unsafe-show-secrets snapshot carries redactSecrets:false).
    const unsafe = serializeSnapshot(fb, {
      pgVersion: "17.6",
      redactSecrets: false,
    });
    expect(deserializeSnapshot(unsafe).redactSecrets).toBe(false);
    expect(deserializeSnapshot(unsafe).factBase.rootHash).toBe(fb.rootHash);
    // a snapshot written without the field parses with redactSecrets undefined.
    expect(
      deserializeSnapshot(serializeSnapshot(fb, { pgVersion: "17.6" }))
        .redactSecrets,
    ).toBeUndefined();
  });

  test("stamps and round-trips the capture profile (string / null / absent)", () => {
    // a named profile round-trips as its declared id
    expect(
      deserializeSnapshot(
        serializeSnapshot(fb, { pgVersion: "17.6", profile: "supabase" }),
      ).profile,
    ).toBe("supabase");
    // an explicit raw capture round-trips as null (distinct from legacy absent)
    expect(
      deserializeSnapshot(
        serializeSnapshot(fb, { pgVersion: "17.6", profile: null }),
      ).profile,
    ).toBeNull();
    // a snapshot written without the field (legacy) parses with profile undefined
    expect(
      deserializeSnapshot(serializeSnapshot(fb, { pgVersion: "17.6" })).profile,
    ).toBeUndefined();
    // the profile stamp is METADATA — it never moves the digest
    expect(
      deserializeSnapshot(
        serializeSnapshot(fb, { pgVersion: "17.6", profile: "supabase" }),
      ).factBase.rootHash,
    ).toBe(fb.rootHash);
    const withStamp = JSON.parse(
      serializeSnapshot(fb, { pgVersion: "17.6", profile: "supabase" }),
    ) as { digest: string };
    const withoutStamp = JSON.parse(
      serializeSnapshot(fb, { pgVersion: "17.6" }),
    ) as { digest: string };
    expect(withStamp.digest).toBe(withoutStamp.digest);
  });

  test("rejects corrupted content (digest re-verification)", () => {
    const json = serializeSnapshot(fb, { pgVersion: "17.6" });
    const doc = JSON.parse(json);
    doc.facts[1].payload.persistence = "u"; // tamper
    expect(() => deserializeSnapshot(JSON.stringify(doc))).toThrow(
      /digest|corrupt/i,
    );
  });
});

describe("snapshot — diagnostics (Codex P2, comment 3601826191)", () => {
  const serverId: StableId = { kind: "server", name: "srv" };
  const mappingId: StableId = {
    kind: "userMapping",
    server: "srv",
    role: "PUBLIC",
  };
  const serverFact: Fact = {
    id: serverId,
    payload: { fdw: "fdw1", type: null, version: null, options: [] },
  };
  const mappingFact: Fact = {
    id: mappingId,
    parent: serverId,
    payload: { options: [] },
  };

  /** A fresh FactBase per test (unlike the shared `fb` above) — pushing onto
   *  `.diagnostics` mutates the instance, and these tests need that mutation
   *  isolated. */
  const withDiagnostic = (): ReturnType<typeof buildFactBase> => {
    const base = buildFactBase([serverFact], []);
    base.diagnostics.push({
      code: USER_MAPPING_UNREADABLE,
      severity: "warning",
      subject: mappingId,
      message: "srv/PUBLIC hidden",
    });
    return base;
  };

  test("round-trip preserves diagnostics, including subject", () => {
    const base = withDiagnostic();
    const json = serializeSnapshot(base, { pgVersion: "17.6" });
    const restored = deserializeSnapshot(json).factBase;

    expect(restored.diagnostics).toHaveLength(1);
    const d = restored.diagnostics[0]!;
    expect(d.code).toBe(USER_MAPPING_UNREADABLE);
    expect(d.severity).toBe("warning");
    expect(d.message).toBe("srv/PUBLIC hidden");
    expect(d.subject).toEqual(mappingId);
  });

  test("plan()'s unreadable-user-mapping gate still fires across a deserialized snapshot", () => {
    // RED today: the gate reads FactBase.diagnostics, but a round-tripped
    // snapshot silently dropped them — no throw, plan() would happily emit
    // DROP/CREATE USER MAPPING for a mapping whose true state is unknown.
    const source = deserializeSnapshot(
      serializeSnapshot(withDiagnostic(), { pgVersion: "17.6" }),
    ).factBase;
    const desired = buildFactBase([serverFact, mappingFact], []);

    expect(() => plan(source, desired)).toThrow(
      /user mappings is unknown on one side/,
    );
  });

  test("digest is identical with and without diagnostics present", () => {
    const bare = buildFactBase([serverFact], []);
    const withDiag = withDiagnostic();
    expect(withDiag.rootHash).toBe(bare.rootHash);

    const bareDoc = JSON.parse(
      serializeSnapshot(bare, { pgVersion: "17.6" }),
    ) as { digest: string };
    const withDiagDoc = JSON.parse(
      serializeSnapshot(withDiag, { pgVersion: "17.6" }),
    ) as { digest: string };
    expect(withDiagDoc.digest).toBe(bareDoc.digest);
  });

  test("an old-format snapshot (no diagnostics field) deserializes fine, with an empty array", () => {
    const json = serializeSnapshot(buildFactBase([serverFact], []), {
      pgVersion: "17.6",
    });
    const doc = JSON.parse(json) as Record<string, unknown>;
    delete doc["diagnostics"];
    const restored = deserializeSnapshot(JSON.stringify(doc)).factBase;
    expect(restored.diagnostics).toEqual([]);
  });
});
