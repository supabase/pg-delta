import { describe, expect } from "vitest";
import { test } from "#test";
import { computeDiff } from "../../diff/diff.ts";
import {
  extractSequenceDefinitions,
  serializeSequenceOperation,
} from "./index.ts";

describe.concurrent("dump sequences", () => {
  test("should roundtrip simple sequence", async ({ db }) => {
    await db.source.sql`
      create sequence public.user_id_seq
        as integer
        start with 1
        increment by 1
        minvalue 1
        maxvalue 2147483647
        cache 1
        no cycle;
    `;
    const sourceSequences = await extractSequenceDefinitions(db.source);

    const diff = computeDiff(undefined, sourceSequences);

    await db.target.query(
      diff.map((d) => serializeSequenceOperation(d)).join("\n"),
    );
    const targetSequences = await extractSequenceDefinitions(db.target);

    expect(sourceSequences).toEqual(targetSequences);
  });
});
