import { describe, expect, test } from "bun:test";
import { buildFactBase } from "./fact.ts";
import { deserializeSnapshot, serializeSnapshot } from "./snapshot.ts";

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

  test("rejects corrupted content (digest re-verification)", () => {
    const json = serializeSnapshot(fb, { pgVersion: "17.6" });
    const doc = JSON.parse(json);
    doc.facts[1].payload.persistence = "u"; // tamper
    expect(() => deserializeSnapshot(JSON.stringify(doc))).toThrow(
      /digest|corrupt/i,
    );
  });
});
