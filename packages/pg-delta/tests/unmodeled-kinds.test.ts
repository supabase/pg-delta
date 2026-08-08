/**
 * v1 correctness floor (review finding 1): the engine must never SILENTLY miss
 * user state. A user-created object in a kind the engine does not model
 * (CAST, operator (class/family), text-search config/dict/parser/template,
 * statistics object, user language, transform) must surface as an
 * `unmodeled_kind` diagnostic on the ExtractResult — never be dropped quietly.
 *
 * Provenance-aware: built-in (pinned) and extension-owned objects of the same
 * kinds are an extension's / the system's internals, NOT user state, so they
 * must NOT be reported.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract, type ExtractResult } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

/** A user CAST, a user TEXT SEARCH CONFIGURATION, and a user STATISTICS object,
 *  created with plain DDL — no extension involved. None of these kinds are
 *  modeled by the v1 engine. */
const UNMODELED_DDL = /* sql */ `
  CREATE DOMAIN postal AS text;
  CREATE FUNCTION postal_to_int(postal) RETURNS integer
    LANGUAGE sql IMMUTABLE AS 'SELECT length($1)';
  CREATE CAST (postal AS integer) WITH FUNCTION postal_to_int(postal);

  CREATE TEXT SEARCH CONFIGURATION mycfg (COPY = english);

  CREATE TABLE stat_tbl (a integer, b integer);
  CREATE STATISTICS mystat (dependencies) ON a, b FROM stat_tbl;
`;

let db: TestDb;
let result: ExtractResult;

beforeAll(async () => {
  db = await createTestDb("unmodeled");
  await db.pool.query(UNMODELED_DDL);
  result = await extract(db.pool);
}, 120_000);

afterAll(async () => {
  await db.drop();
});

function unmodeledFor(kind: string) {
  return result.diagnostics.find(
    (d) => d.code === "unmodeled_kind" && d.context?.["kind"] === kind,
  );
}

describe("extract: unmodeled-kind detection", () => {
  test("a user CAST is reported, not silently dropped", () => {
    const d = unmodeledFor("cast");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warning");
    expect(d?.context?.["count"]).toBe(1);
    expect(d?.context?.["samples"]).toBeArray();
    expect(((d?.context?.["samples"] ?? []) as string[]).join(" ")).toContain(
      "postal",
    );
  });

  test("a user TEXT SEARCH CONFIGURATION is reported", () => {
    const d = unmodeledFor("text search configuration");
    expect(d).toBeDefined();
    expect(((d?.context?.["samples"] ?? []) as string[]).join(" ")).toContain(
      "mycfg",
    );
  });

  test("a user STATISTICS object is reported", () => {
    const d = unmodeledFor("statistics object");
    expect(d).toBeDefined();
    expect(((d?.context?.["samples"] ?? []) as string[]).join(" ")).toContain(
      "mystat",
    );
  });

  test("the diagnostic message names the kind so it is human-actionable", () => {
    const d = unmodeledFor("cast");
    expect(d?.message).toContain("cast");
    expect(d?.message.toLowerCase()).toContain("not managed");
  });
});

describe("extract: unmodeled-kind detection is provenance-aware", () => {
  let extDb: TestDb;
  let extResult: ExtractResult;

  beforeAll(async () => {
    extDb = await createTestDb("unmodeled_ext");
    // citext (contrib) ships casts, operators, and operator classes — all
    // extension-owned. They must NOT be reported as user state.
    await extDb.pool.query(`CREATE EXTENSION citext`);
    extResult = await extract(extDb.pool);
  }, 120_000);

  afterAll(async () => {
    await extDb.drop();
  });

  test("extension-owned casts/operators/opclasses are NOT reported", () => {
    const unmodeled = extResult.diagnostics.filter(
      (d) => d.code === "unmodeled_kind",
    );
    expect(unmodeled).toEqual([]);
  });
});

describe("extract: unmodeled-kind detection is deptype='i' aware", () => {
  let rangeDb: TestDb;
  let rangeResult: ExtractResult;

  beforeAll(async () => {
    rangeDb = await createTestDb("unmodeled_range");
    // CREATE TYPE ... AS RANGE auto-creates a range->multirange cast
    // (pg_depend deptype = 'i', internal to the range type). The range type
    // itself is modeled, so its auto-cast is not a silent miss and must NOT
    // be reported as an unmodeled kind.
    await rangeDb.pool.query(
      `CREATE TYPE public.floatrange AS RANGE (subtype = float8)`,
    );
    rangeResult = await extract(rangeDb.pool);
  }, 120_000);

  afterAll(async () => {
    await rangeDb.drop();
  });

  test("the range type's auto-created multirange cast is NOT reported", () => {
    const unmodeled = rangeResult.diagnostics.filter(
      (d) => d.code === "unmodeled_kind",
    );
    expect(unmodeled).toEqual([]);
  });
});
