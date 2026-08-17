import { describe, expect, test } from "bun:test";
import { sourceKeyForReplayFailure } from "./repair.ts";
import type { ManifestEntry } from "./emit/index.ts";
import type { ReplayFailure } from "./replay/index.ts";

const manifest: ManifestEntry[] = [
  {
    outputFile: "0001_squashed.sql",
    statementIndex: 0,
    source: {
      file: "0001_table.sql",
      statementIndex: 0,
      bytes: { start: 0, end: 10 },
    },
  },
  {
    outputFile: "0001_squashed.sql",
    statementIndex: 1,
    source: {
      file: "0002_drop.sql",
      statementIndex: 0,
      bytes: { start: 0, end: 20 },
    },
  },
];

const failure = (statementIndex: number): ReplayFailure => ({
  file: "0001_squashed.sql",
  statementIndex,
  sql: "DROP INDEX CONCURRENTLY t_id;",
  sqlstate: "25001",
  message: "DROP INDEX CONCURRENTLY cannot run inside a transaction block",
  nonTransactional: true,
});

describe("sourceKeyForReplayFailure", () => {
  test("maps the failing candidate statement onto its source key", () => {
    expect(sourceKeyForReplayFailure(failure(1), manifest)).toBe(
      "0002_drop.sql:0",
    );
  });

  test("accounts for an injected BEGIN wrapping the file", () => {
    expect(sourceKeyForReplayFailure(failure(2), manifest)).toBe(
      "0002_drop.sql:0",
    );
  });

  test("returns undefined when the file is not in the manifest", () => {
    expect(
      sourceKeyForReplayFailure(
        { ...failure(0), file: "0009_squashed.sql" },
        manifest,
      ),
    ).toBeUndefined();
  });
});
