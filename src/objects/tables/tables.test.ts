import { describe, expect } from "vitest";
import { test } from "#test";
import { computeDiff } from "../../diff/diff.ts";
import { extractTableDefinitions } from "./extract.ts";
import { serializeTableOperation } from "./serialize/index.ts";

describe.concurrent("dump tables", () => {
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

    const diff = computeDiff(undefined, sourceTables);

    await db.target.query(
      diff.map((d) => serializeTableOperation(d)).join("\n"),
    );
    const targetTables = await extractTableDefinitions(db.target);

    expect(sourceTables).toEqual(targetTables);
  });
});
