import { describe, expect } from "vitest";
import { test } from "#test";
import { extractDefinitions, serializeDefinitions } from "./dump.ts";

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

    await db.target.exec(serializeDefinitions(sourceDefinitions));
    const targetDefinitions = await extractDefinitions(db.target);

    expect(sourceDefinitions).toEqual(targetDefinitions);
  });
});
