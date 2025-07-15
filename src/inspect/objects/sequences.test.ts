import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest, pick } from "../../../tests/migra/utils.ts";
import { inspectSequences } from "./sequences.ts";

describe.concurrent("inspect sequences", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to inspect stable properties of sequences`, async ({
        db,
      }) => {
        // arrange
        const fixture = /* sql */ `
            create sequence test_sequence;
          `;
        await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
        // act
        const filterResult = pick(["public.test_sequence"]);
        const [resultA, resultB] = await Promise.all([
          inspectSequences(db.a).then(filterResult),
          inspectSequences(db.b).then(filterResult),
        ]);
        // assert
        expect(resultA).toStrictEqual({
          "public.test_sequence": {
            cache_size: "1",
            cycle_option: false,
            data_type: "bigint",
            increment: "1",
            maximum_value: "9223372036854775807",
            minimum_value: "1",
            name: "test_sequence",
            owner: "supabase_admin",
            persistence: "p",
            schema: "public",
            start_value: "1",
            dependent_on: [],
            dependents: [],
          },
        });
        expect(resultB).toStrictEqual(resultA);
      });
    });
  }
});
