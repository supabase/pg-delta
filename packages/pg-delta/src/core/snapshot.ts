/**
 * Snapshot format v1 (target-architecture §3.1/§3.2): the serialized fact
 * base. Version-tagged; digest re-verified on load (a corrupted snapshot
 * must never silently plan).
 */
import type { Diagnostic } from "./diagnostic.ts";
import {
  buildFactBase,
  type DependencyEdge,
  type EdgeKind,
  FactBase,
} from "./fact.ts";
import type { Payload, PayloadValue } from "./hash.ts";
import { encodeId, parseId } from "./stable-id.ts";

const FORMAT_VERSION = 1;

interface SnapshotDiagnostic {
  code: string;
  severity: Diagnostic["severity"];
  subject?: string;
  message: string;
  context?: Record<string, unknown>;
}

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
  /** the profile this snapshot was CAPTURED under (`pgdelta snapshot --profile`),
   *  as the profile's DECLARED id — the same value `Plan.profile.id` carries. So
   *  `drift`/`prove` re-extract the live env with the SAME handler-aware profile
   *  the snapshot's facts were produced with, instead of silently comparing a
   *  raw extract against handler-aware facts (or vice versa). Three-state, like
   *  `ExportManifest.defaultOwner`: a string id, `null` (captured raw — the
   *  reconcile treats this as the concrete "raw" profile), or ABSENT (a snapshot
   *  written before this field existed — legacy, the reconcile lets a --profile
   *  flag win). Metadata only: it describes how the facts were produced and
   *  NEVER affects the digest, which is `fb.rootHash`. */
  profile?: string | null;
  digest: string;
  facts: Array<{ id: string; parent?: string; payload: unknown }>;
  edges: Array<{ from: string; to: string; kind: EdgeKind }>;
  /** `FactBase.diagnostics` — carried through so a `plan()` gate that reads
   *  them (e.g. `USER_MAPPING_UNREADABLE`) still fires when one side of a
   *  diff is a deserialized snapshot rather than a live extraction. Metadata
   *  only, like `capturedAt`/`redactSecrets`: NEVER affects `digest`, which is
   *  `fb.rootHash` — a pure fold over facts/edges (see fact.ts) that never
   *  reads `.diagnostics`. Missing on an old-format snapshot (pre-dating this
   *  field) → deserializes as an empty array, no error; such a snapshot is
   *  simply ungated (matches its pre-existing behavior, never worse). */
  diagnostics?: SnapshotDiagnostic[];
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
  meta: {
    pgVersion: string;
    capturedAt?: string;
    redactSecrets?: boolean;
    profile?: string | null;
  },
): string {
  const doc: SnapshotDoc = {
    formatVersion: FORMAT_VERSION,
    pgVersion: meta.pgVersion,
    ...(meta.capturedAt !== undefined ? { capturedAt: meta.capturedAt } : {}),
    ...(meta.redactSecrets !== undefined
      ? { redactSecrets: meta.redactSecrets }
      : {}),
    // `null` is a MEANINGFUL value here (captured raw), distinct from ABSENT
    // (legacy) — so include the key whenever it is not `undefined`.
    ...(meta.profile !== undefined ? { profile: meta.profile } : {}),
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
    // ALL diagnostics, not a code-specific subset (also closes the pre-existing
    // INTENT_UNKEYED snapshot hole) — deterministically sorted so the document
    // is stable regardless of extraction/accumulation order.
    diagnostics: fb.diagnostics
      .map((d) => ({
        code: d.code,
        severity: d.severity,
        ...(d.subject !== undefined ? { subject: encodeId(d.subject) } : {}),
        message: d.message,
        ...(d.context !== undefined ? { context: d.context } : {}),
      }))
      .sort((a, b) => {
        if (a.code !== b.code) return a.code < b.code ? -1 : 1;
        const aSubject = a.subject ?? "";
        const bSubject = b.subject ?? "";
        if (aSubject !== bSubject) return aSubject < bSubject ? -1 : 1;
        return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
      }),
  };
  return JSON.stringify(doc, null, 2);
}

export function deserializeSnapshot(json: string): {
  factBase: FactBase;
  pgVersion: string;
  redactSecrets?: boolean;
  profile?: string | null;
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
  // Missing on an old-format snapshot (pre-dating this field) → `?? []`, no
  // error; rides on the FactBase itself (the same seam handler / extraction
  // diagnostics use) so a `plan()` gate that reads `FactBase.diagnostics`
  // (e.g. USER_MAPPING_UNREADABLE) still fires across a deserialized snapshot.
  factBase.diagnostics.push(
    ...(doc.diagnostics ?? []).map(
      (d): Diagnostic => ({
        code: d.code,
        severity: d.severity,
        ...(d.subject !== undefined ? { subject: parseId(d.subject) } : {}),
        message: d.message,
        ...(d.context !== undefined ? { context: d.context } : {}),
      }),
    ),
  );
  return {
    factBase,
    pgVersion: doc.pgVersion,
    ...(doc.redactSecrets !== undefined
      ? { redactSecrets: doc.redactSecrets }
      : {}),
    // preserve the three states: string / `null` (captured raw) / ABSENT (legacy).
    ...(doc.profile !== undefined ? { profile: doc.profile } : {}),
  };
}
