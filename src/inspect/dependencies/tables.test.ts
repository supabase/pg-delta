import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/constants.ts";
import { getTest } from "../../../tests/utils.ts";
import { inspect } from "../inspect.ts";
import { buildDependencies, inspectDependencies } from "./dependencies.ts";
import { buildTableDependencies } from "./tables.ts";

describe.concurrent("table dependencies", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`table inheritance`, async ({ db }) => {
        // arrange
        const fixture = /* sql */ `
            create table base_inherit (
              id serial primary key,
              data text
            );
            create table child_inherit (
              extra text
            ) inherits (base_inherit);
          `;
        await db.a.unsafe(fixture);

        // act
        const inspection = await inspect(db.a);
        const dependencies = await inspectDependencies(db.a);
        buildTableDependencies(dependencies, inspection);

        // assert
        expect(inspection).toMatchObject({
          // Inheritance: child_inherit depends on base_inherit
          "table:public.base_inherit": {
            dependents: expect.arrayContaining(["table:public.child_inherit"]),
          },
          "table:public.child_inherit": {
            dependent_on: expect.arrayContaining(["table:public.base_inherit"]),
          },
        });
      });

      test(`table partitioning`, async ({ db }) => {
        // arrange
        const fixture = /* sql */ `
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
        const dependencies = await inspectDependencies(db.a);
        buildTableDependencies(dependencies, inspection);

        // assert
        expect(inspection).toMatchObject({
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

      test.only("table depends on composite type", async ({ db }) => {
        // arrange
        const fixture = /* sql */ `
          create schema my_schema;
          create type "my_composite.weird" as (a int, b text);
          create table t_composite (c "my_composite.weird");
        `;
        await db.a.unsafe(fixture);

        // act
        const inspection = await inspect(db.a);
        const dependencies = await inspectDependencies(db.a);
        buildTableDependencies(dependencies, inspection);
        console.log(
          JSON.stringify(inspection["table:public.t_composite"], null, 2),
        );
        // assert
        expect(inspection).toMatchObject({
          "table:public.t_composite": {
            columns: [
              {
                name: "c",
                dependent_on: expect.arrayContaining([
                  "compositeType:public.my_composite",
                ]),
              },
            ],
          },
        });
      });

      test("table depends on enum", async ({ db }) => {
        // arrange
        const fixture = /* sql */ `
          create type my_enum as enum ('a', 'b');
          create table t_enum (e my_enum);
        `;
        await db.a.unsafe(fixture);

        // act
        const inspection = await inspect(db.a);
        await buildDependencies(db.a, inspection);

        // assert
        expect(inspection).toMatchObject({
          "table:public.t_enum": {
            dependent_on: expect.arrayContaining(["enum:public.my_enum"]),
          },
        });
      });

      test("table depends on domain", async ({ db }) => {
        // arrange
        const fixture = /* sql */ `
          create domain my_domain as int check (value > 0);
          create table t_domain (d my_domain);
        `;
        await db.a.unsafe(fixture);

        // act
        const inspection = await inspect(db.a);
        await buildDependencies(db.a, inspection);

        // assert
        expect(inspection).toMatchObject({
          "table:public.t_domain": {
            dependent_on: expect.arrayContaining(["domain:public.my_domain"]),
          },
        });
      });

      test("table depends on sequence", async ({ db }) => {
        // arrange
        const fixture = /* sql */ `
          create sequence my_seq;
          create table t_seq (id int default nextval('my_seq'));
        `;
        await db.a.unsafe(fixture);

        // act
        const inspection = await inspect(db.a);
        await buildDependencies(db.a, inspection);

        // assert
        expect(inspection).toMatchObject({
          "table:public.t_seq": {
            dependent_on: expect.arrayContaining(["sequence:public.my_seq"]),
          },
        });
      });

      test("table depends on another table via foreign key", async ({ db }) => {
        // arrange
        const fixture = /* sql */ `
          create table parent_fk (id serial primary key);
          create table child_fk (parent_id int references parent_fk(id));
        `;
        await db.a.unsafe(fixture);

        // act
        const inspection = await inspect(db.a);
        await buildDependencies(db.a, inspection);

        // assert
        expect(inspection).toMatchObject({
          "table:public.child_fk": {
            dependent_on: expect.arrayContaining(["table:public.parent_fk"]),
          },
        });
      });

      test("table depends on collation", async ({ db }) => {
        // arrange
        const fixture = /* sql */ `
          create collation my_collation (locale = 'C');
          create table t_collation (name text collate my_collation);
        `;
        await db.a.unsafe(fixture);

        // act
        const inspection = await inspect(db.a);
        await buildDependencies(db.a, inspection);

        // assert
        expect(inspection).toMatchObject({
          "table:public.t_collation": {
            dependent_on: expect.arrayContaining([
              "collation:public.my_collation",
            ]),
          },
        });
      });
    });
  }
});
