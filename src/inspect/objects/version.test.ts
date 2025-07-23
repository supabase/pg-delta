import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/constants.ts";
import { getTest } from "../../../tests/utils.ts";
import { inspectVersion } from "./version.ts";

describe.concurrent("inspect version", () => {
  const assertions = new Map([
    ["15", 150000],
    ["16", 160000],
    ["17", 170000],
  ]);
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to inspect PostgreSQL version`, async ({ db }) => {
        // act
        const resultA = await inspectVersion(db.a);
        const resultB = await inspectVersion(db.b);

        // assert
        const assertion =
          assertions.get(`${postgresVersion}`) === undefined
            ? assertions.get("default")
            : assertions.get(`${postgresVersion}`);
        // Check that our version is on the right major
        // biome-ignore lint/style/noNonNullAssertion: no-op
        expect(resultA.version).toBeGreaterThanOrEqual(assertion!);
        // biome-ignore lint/style/noNonNullAssertion: no-op
        expect(resultA.version).toBeLessThan(assertion! + 10000);
        expect(resultA).toEqual(resultB);
      });
    });
  }
});
