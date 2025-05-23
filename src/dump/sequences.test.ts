import { describe, expect } from "vitest";
import { test } from "#test";
import { extractSequences, serializeSequences } from "./sequences.ts";

describe("dump sequences", () => {
  test("should roundtrip simple sequence", async ({ db }) => {
    await db.source.sql`
      create sequence public.my_sequence
        as integer
        start with 1
        increment by 1
        minvalue 1
        maxvalue 2147483647
        cache 1
        no cycle;
    `;
    const sourceSequences = await extractSequences(db.source);

    await db.target.query(serializeSequences(sourceSequences));
    const targetSequences = await extractSequences(db.target);

    expect(sourceSequences).toEqual(targetSequences);
  });
});
