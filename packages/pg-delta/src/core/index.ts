/**
 * Core barrel: stable-id codec, hash/payload primitives, fact-base
 * construction, snapshot round-trip, diff engine, and diagnostics.
 * These are the stable building blocks; the planning, apply, and proof
 * layers sit on top of them.
 */
export { NotImplementedError, type Diagnostic } from "./diagnostic.ts";
export {
  encodeId,
  parseId,
  type StableId,
  type FactKind,
} from "./stable-id.ts";
export {
  canonicalize,
  contentHash,
  type Payload,
  type ContentHash,
} from "./hash.ts";
export {
  buildFactBase,
  FactBase,
  type Fact,
  type DependencyEdge,
  type EdgeKind,
} from "./fact.ts";
export { serializeSnapshot, deserializeSnapshot } from "./snapshot.ts";
export { diff, type Delta } from "./diff.ts";
