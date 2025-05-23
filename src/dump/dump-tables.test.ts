import { describe, expect } from "vitest";
import { test } from "#test";
import { dumpTables, serializeTables } from "./dump-tables.ts";

describe("dump+serialize pipeline", () => {
  test("should roundtrip simple table", async ({ db }) => {
    await db.source.sql`
      create table public.users (
        id integer primary key,
        name text not null,
        email text,
        created_at timestamptz default now()
      );
    `;
    const sourceTables = await dumpTables(db.source);
    await db.target.query(serializeTables(sourceTables));
    const targetTables = await dumpTables(db.target);
    expect(sourceTables).toStrictEqual(targetTables);
  });
});
