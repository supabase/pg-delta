import { describe, expect, test } from "bun:test";
import { loadCorpus } from "./corpus.ts";

describe("loadCorpus direction-specific seeds", () => {
  test("loads seed-b.sql for the reverse direction", () => {
    const scenario = loadCorpus().find(
      (entry) => entry.name === "constraint-ops--convert-pk-to-temporal",
    );

    expect(scenario?.seed).toContain("INSERT INTO test_schema.bookings");
    expect(scenario?.seedB).toContain("INSERT INTO test_schema.bookings");
  });
});
