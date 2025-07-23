import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/constants.ts";
import { getTest } from "../../../tests/utils.ts";
import { inspect } from "../inspect.ts";
import { buildDependencies } from "./dependencies.ts";

describe.concurrent(
  "build dependencies",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to build selectable dependencies`, async ({
          db,
        }) => {
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

            -- Add a child table inheriting from test_table
            create table child_table (
              extra_col text
            ) inherits (test_table);
          `;
          await db.a.unsafe(fixture);
          // act
          const inspection = await inspect(db.a);
          await buildDependencies(db.a, inspection);
          // assert
          expect(inspection).toMatchObject({
            // Function and its dependent view
            "function:public.test_func_with_args(arg1 integer, arg2 text)": {
              dependent_on: [],
              dependents: expect.arrayContaining([
                "view:public.test_view_func",
              ]),
            },
            // Base table and its dependents (view, child table)
            "table:public.test_table": {
              dependent_on: [],
              dependents: expect.arrayContaining([
                "table:public.child_table",
                "view:public.test_view",
              ]),
            },
            // View depending on test_table
            "view:public.test_view": {
              dependent_on: expect.arrayContaining(["table:public.test_table"]),
              dependents: [],
            },
            // View depending on function
            "view:public.test_view_func": {
              dependent_on: expect.arrayContaining([
                "function:public.test_func_with_args(arg1 integer, arg2 text)",
              ]),
              dependents: [],
            },
            // Child table inheriting from test_table
            "table:public.child_table": {
              dependent_on: expect.arrayContaining(["table:public.test_table"]),
              dependents: [],
            },
          });
        });

        test(`should be able to build partitioned and inherited table dependencies`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
          -- Inheritance
          create table base_inherit (
            id serial primary key,
            data text
          );
          create table child_inherit (
            extra text
          ) inherits (base_inherit);

          -- Partitioning
          create table base_partition (
            id int,
            data text
          ) partition by range (id);

          create table part1 partition of base_partition for values from (1) to (100);
          create table part2 partition of base_partition for values from (100) to (200);
        `;
          await db.a.unsafe(fixture);

          // act
          const inspection = await inspect(db.a);
          await buildDependencies(db.a, inspection);

          // assert
          expect(inspection).toMatchObject({
            // Inheritance: child_inherit depends on base_inherit
            "table:public.base_inherit": {
              dependents: expect.arrayContaining([
                "table:public.child_inherit",
              ]),
            },
            "table:public.child_inherit": {
              dependent_on: expect.arrayContaining([
                "table:public.base_inherit",
              ]),
            },

            // Partitioning: part1 and part2 depend on base_partition
            "table:public.base_partition": {
              dependents: expect.arrayContaining([
                "table:public.part1",
                "table:public.part2",
              ]),
            },
            "table:public.part1": {
              dependent_on: expect.arrayContaining([
                "table:public.base_partition",
              ]),
            },
            "table:public.part2": {
              dependent_on: expect.arrayContaining([
                "table:public.base_partition",
              ]),
            },
          });
        });

        test("should handle trigger dependencies", async ({ db }) => {
          // arrange
          const fixture = /* sql */ `
            create table t (id serial primary key);

            create function trig_fn() returns trigger as $$
            begin
              return new;
            end;
            $$ language plpgsql;

            create trigger trig1
              before insert on t
              for each row
              execute function trig_fn();
          `;
          await db.a.unsafe(fixture);

          // act
          const inspection = await inspect(db.a);
          await buildDependencies(db.a, inspection);

          // assert
          expect(inspection).toMatchObject({
            // Function
            "function:public.trig_fn()": {
              dependents: expect.arrayContaining(["trigger:public.t.trig1"]),
            },
            // Trigger
            "trigger:public.t.trig1": {
              dependent_on: expect.arrayContaining([
                "function:public.trig_fn()",
                "table:public.t",
              ]),
            },
            // Table
            "table:public.t": {
              dependents: expect.arrayContaining(["trigger:public.t.trig1"]),
            },
          });
        });
      });
    }
  },
  30_000,
);
