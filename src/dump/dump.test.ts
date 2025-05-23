import { describe, expect } from "vitest";
import { test } from "#test";
import { extract, serialize } from "./dump.ts";

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
    const sourceDefinitions = await extract(db.source);

    await db.target.exec(serialize(sourceDefinitions));
    const targetDefinitions = await extract(db.target);

    expect(sourceDefinitions).toEqual(targetDefinitions);
  });
});
