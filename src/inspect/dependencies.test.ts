import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../tests/migra/constants.ts";
import { getTest } from "../../tests/migra/utils.ts";
import { buildDependencies } from "./dependencies.ts";
import { inspect } from "./inspect.ts";

describe.concurrent(
  "build dependencies",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to build dependencies`, async ({ db }) => {
          // arrange
          const fixture = /* sql */ `
            create table test_table (
              id serial primary key,
              name text
            );

            create view test_view as select id, name from test_table;

            create function test_func_with_args(arg1 integer, arg2 text default 'foo') returns table(val integer) as $$
              select arg1 as val;
            $$ language sql;

            create view test_view_func as
              select * from test_func_with_args(42, 'bar');
          `;
          await db.a.unsafe(fixture);
          // act
          const inspection = await inspect(db.a);
          await buildDependencies(db.a, inspection);
          // assert
          expect(inspection).toMatchObject({
            "function:public.test_func_with_args(arg1 integer, arg2 text)": {
              dependent_on: ["view:public.test_view_func"],
              dependents: [],
            },
            "table:public.test_table": {
              dependent_on: ["view:public.test_view"],
              dependents: [],
            },
            "view:public.test_view": {
              dependent_on: [],
              dependents: ["table:public.test_table"],
            },
            "view:public.test_view_func": {
              dependent_on: [],
              dependents: [
                "function:public.test_func_with_args(arg1 integer, arg2 text)",
              ],
            },
          });
        });
      });
    }
  },
  30_000,
);
