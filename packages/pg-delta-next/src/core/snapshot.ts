/**
 * Snapshot format v1 (target-architecture §3.1/§3.2): the serialized fact
 * base. Version-tagged; digest re-verified on load (a corrupted snapshot
 * must never silently plan).
 */
import {
  buildFactBase,
  type DependencyEdge,
  type EdgeKind,
  FactBase,
} from "./fact.ts";
import type { Payload, PayloadValue } from "./hash.ts";
import { encodeId, parseId } from "./stable-id.ts";

const FORMAT_VERSION = 1;

interface SnapshotDoc {
  formatVersion: number;
  pgVersion: string;
  /** ISO-8601 capture time; auditability only, never affects the digest */
  capturedAt?: string;
  /** whether secrets were redacted when this snapshot was extracted. Recorded
   *  so `drift` re-extracts the live env with the SAME mode — an unredacted
   *  (`--unsafe-show-secrets`) snapshot compared against a default-redacted live
   *  extract would report placeholder-vs-real drift. Metadata only: it describes
   *  how the facts were produced and never affects the digest. */
  redactSecrets?: boolean;
  digest: string;
  facts: Array<{ id: string; parent?: string; payload: unknown }>;
  edges: Array<{ from: string; to: string; kind: EdgeKind }>;
}

/** bigint-safe JSON: bigints encode as {"$bigint":"..."} */
function encodePayload(value: PayloadValue): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(encodePayload);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = encodePayload(v);
    }
    return out;
  }
  return value;
}

function decodePayload(value: unknown): PayloadValue {
  if (Array.isArray(value)) return value.map(decodePayload);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj["$bigint"] === "string" && Object.keys(obj).length === 1) {
      return BigInt(obj["$bigint"]);
    }
    const out: Record<string, PayloadValue> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = decodePayload(v);
    return out;
  }
  return value as PayloadValue;
}

export function serializeSnapshot(
  fb: FactBase,
  meta: { pgVersion: string; capturedAt?: string; redactSecrets?: boolean },
): string {
  const doc: SnapshotDoc = {
    formatVersion: FORMAT_VERSION,
    pgVersion: meta.pgVersion,
    ...(meta.capturedAt !== undefined ? { capturedAt: meta.capturedAt } : {}),
    ...(meta.redactSecrets !== undefined
      ? { redactSecrets: meta.redactSecrets }
      : {}),
    digest: fb.rootHash,
    facts: fb
      .facts()
      .map((f) => ({
        id: encodeId(f.id),
        ...(f.parent !== undefined ? { parent: encodeId(f.parent) } : {}),
        payload: encodePayload(f.payload),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: fb.edges
      .map((e) => ({
        from: encodeId(e.from),
        to: encodeId(e.to),
        kind: e.kind,
      }))
      .sort((a, b) =>
        `${a.from}|${a.kind}|${a.to}` < `${b.from}|${b.kind}|${b.to}` ? -1 : 1,
      ),
  };
  return JSON.stringify(doc, null, 2);
}

export function deserializeSnapshot(json: string): {
  factBase: FactBase;
  pgVersion: string;
  redactSecrets?: boolean;
} {
  const doc = JSON.parse(json) as SnapshotDoc;
  if (doc.formatVersion !== FORMAT_VERSION) {
    throw new Error(
      `snapshot formatVersion ${doc.formatVersion} is not supported (expected ${FORMAT_VERSION})`,
    );
  }
  const facts = doc.facts.map((f) => ({
    id: parseId(f.id),
    ...(f.parent !== undefined ? { parent: parseId(f.parent) } : {}),
    payload: decodePayload(f.payload) as Payload,
  }));
  const edges: DependencyEdge[] = doc.edges.map((e) => ({
    from: parseId(e.from),
    to: parseId(e.to),
    kind: e.kind,
  }));
  const factBase = buildFactBase(facts, edges, "snapshot");
  if (factBase.rootHash !== doc.digest) {
    throw new Error(
      `snapshot digest mismatch — content is corrupt or was edited (expected ${doc.digest}, computed ${factBase.rootHash})`,
    );
  }
  return {
    factBase,
    pgVersion: doc.pgVersion,
    ...(doc.redactSecrets !== undefined
      ? { redactSecrets: doc.redactSecrets }
      : {}),
  };
}
