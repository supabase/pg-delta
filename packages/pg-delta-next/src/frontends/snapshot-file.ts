/**
 * Snapshot file frontend: persist and restore a FactBase as a JSON file on
 * the local filesystem. The byte format is fully owned by core/snapshot.ts
 * (format-version + digest); this module adds only the file I/O layer.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deserializeSnapshot, serializeSnapshot } from "../core/snapshot.ts";
import type { FactBase } from "../core/fact.ts";

/**
 * Serialize `fb` and write it to `path`. The pgVersion string is stored in
 * the snapshot so the reader can surface a mismatch warning when the
 * environment has moved on.
 *
 * Writes synchronously (atomic-enough for CLI tools; swap-on-write is a
 * future hardening step).
 */
export function saveSnapshot(
  fb: FactBase,
  pgVersion: string,
  path: string,
  redactSecrets?: boolean,
): void {
  const json = serializeSnapshot(fb, {
    pgVersion,
    ...(redactSecrets !== undefined ? { redactSecrets } : {}),
  });
  writeFileSync(path, json, "utf8");
}

/**
 * Read and deserialize a snapshot from `path`.
 * Throws if the file does not exist, is invalid JSON, has an unsupported
 * format version, or fails its content-hash check.
 */
export function loadSnapshot(path: string): {
  factBase: FactBase;
  pgVersion: string;
  redactSecrets?: boolean;
} {
  const json = readFileSync(path, "utf8");
  return deserializeSnapshot(json);
}
