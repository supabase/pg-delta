/**
 * CREATE EXTENSION emits `SCHEMA <s>` whenever the extension is installed into a
 * schema that exists independently — every relocatable extension, and a
 * NON-relocatable one whose schema it did not create itself (e.g. pg_net into
 * Supabase's "extensions"). Only an extension that creates its OWN schema
 * (`_schemaIsMember`) omits the clause. Gating on `relocatable` alone dropped the
 * clause for pg_net, so it installed in the wrong schema (regression).
 */
import { describe, expect, test } from "bun:test";
import type { Fact } from "../../core/fact.ts";
import type { Payload } from "../../core/hash.ts";
import type { FactView } from "../rules.ts";
import { schemaRules } from "./schemas.ts";

const VIEW = {} as FactView; // the extension create rule ignores the view

function createSql(payload: Payload): string {
  const fact: Fact = { id: { kind: "extension", name: "pg_net" }, payload };
  return schemaRules.extension!.create(fact, VIEW)[0]!.sql;
}

describe("CREATE EXTENSION schema clause", () => {
  test("non-relocatable extension in an independent schema emits SCHEMA", () => {
    expect(
      createSql({
        schema: "extensions",
        relocatable: false,
        _schemaIsMember: false,
      }),
    ).toBe(`CREATE EXTENSION "pg_net" SCHEMA "extensions"`);
  });

  test("relocatable extension emits SCHEMA (unchanged)", () => {
    expect(
      createSql({
        schema: "extensions",
        relocatable: true,
        _schemaIsMember: false,
      }),
    ).toBe(`CREATE EXTENSION "pg_net" SCHEMA "extensions"`);
  });

  test("extension that creates its own schema emits a bare CREATE", () => {
    expect(
      createSql({
        schema: "pg_net_own",
        relocatable: false,
        _schemaIsMember: true,
      }),
    ).toBe(`CREATE EXTENSION "pg_net"`);
  });
});
