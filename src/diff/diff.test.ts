import { describe, expect } from "vitest";
import { test } from "#test";
import { computeSchemaDiff, generateMigration } from "./diff.ts";
import { extractDefinitions } from "./extract.ts";
import { serializeSchemaDiff } from "./serialize.ts";

describe("dump", () => {
  test("should roundtrip simple database", async ({ db }) => {
    await db.source.sql`
      create table public.users (
        id serial primary key,
        name text not null,
        email text,
        created_at timestamptz default now()
      );
    `;
    const sourceDefinitions = await extractDefinitions(db.source);

    const diff = computeSchemaDiff({
      target: sourceDefinitions,
    });

    await db.target.exec(serializeSchemaDiff(diff));
    const targetDefinitions = await extractDefinitions(db.target);

    expect(sourceDefinitions).toEqual(targetDefinitions);
  });
});

describe("diff", () => {
  test("should generate migration between two databases", async ({ db }) => {
    const schema = /*sql*/ `
      create table public.users (
        id serial primary key,
        name text not null,
        email text,
        created_at timestamptz default now()
      );
    `;
    await db.source.exec(schema);
    await db.target.exec(schema);

    await db.target.sql`
      alter table public.users add column age int;
    `;

    const { sql } = await generateMigration(db.source, db.target);
    await db.source.exec(sql);

    const sourceDefinitions = await extractDefinitions(db.source);
    const targetDefinitions = await extractDefinitions(db.target);

    expect(sourceDefinitions).toEqual(targetDefinitions);
  });
});
