import { describe, expect } from "vitest";
import { test } from "#test";
import {
  extractTableDefinitions,
  serializeTableDefinitions,
} from "./tables.ts";

describe("dump tables", () => {
  test("should roundtrip simple table", async ({ db }) => {
    await db.source.sql`
      create table public.users (
        id integer primary key,
        name text not null,
        email text,
        created_at timestamptz default now()
      );
    `;
    const sourceTables = await extractTableDefinitions(db.source);

    await db.target.query(serializeTableDefinitions(sourceTables));
    const targetTables = await extractTableDefinitions(db.target);

    expect(sourceTables).toEqual(targetTables);
  });
});
