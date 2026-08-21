import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { exportSqlFiles } from "./export-sql-files.ts";

const publicSchema = { kind: "schema" as const, name: "public" };

function dump(facts: Fact[], createExtensionIfNotExists?: boolean): string {
  const options =
    createExtensionIfNotExists === true
      ? { createExtensionIfNotExists: true }
      : {};
  return exportSqlFiles(buildFactBase(facts, []), options)
    .map((f) => f.sql)
    .join("\n");
}

describe("export CREATE EXTENSION IF NOT EXISTS", () => {
  test("default export stays plain CREATE (SCHEMA into public)", () => {
    const sql = dump([
      { id: publicSchema, payload: {} },
      {
        id: { kind: "extension", name: "pgcrypto" },
        payload: { schema: "public", _relocatable: true },
      },
    ]);
    expect(sql).toContain(`CREATE EXTENSION "pgcrypto" SCHEMA "public"`);
    expect(sql).not.toContain("IF NOT EXISTS");
  });

  test("option emits IF NOT EXISTS on SCHEMA form", () => {
    const sql = dump(
      [
        { id: publicSchema, payload: {} },
        {
          id: { kind: "extension", name: "pgcrypto" },
          payload: { schema: "public", _relocatable: true },
        },
      ],
      true,
    );
    expect(sql).toContain(
      `CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA "public"`,
    );
  });

  test("option emits IF NOT EXISTS on bare form", () => {
    const sql = dump(
      [
        { id: publicSchema, payload: {} },
        {
          id: { kind: "extension", name: "pgmq" },
          payload: { schema: "pgmq", _relocatable: false },
        },
      ],
      true,
    );
    expect(sql).toContain(`CREATE EXTENSION IF NOT EXISTS "pgmq"`);
    expect(sql).not.toContain(`SCHEMA "pgmq"`);
  });
});
