import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { getFixtures } from "./utils.ts";

const fixtures = await getFixtures();

describe.concurrent(
  "migra",
  () => {
    for (const fixture of fixtures) {
      for (const postgresVersion of POSTGRES_VERSIONS) {
        describe(`postgres ${postgresVersion}`, () => {
          const test = getTest(postgresVersion);

          test(`should diff ${fixture.folder}`, async ({ db }) => {
            // arrange
            await Promise.all([db.a.unsafe(fixture.a), db.b.unsafe(fixture.b)]);
            // act
            const result = "";
            // assert
            expect(result).toBe(fixture.expected);

            if (fixture.additions) {
              // arrange
              await db.b.unsafe(fixture.additions);
              // act
              const result2 = "";
              // assert
              expect(result2).toBe(fixture.expected2);
            }
          });
        });
      }
    }
  },
  30_000,
);
