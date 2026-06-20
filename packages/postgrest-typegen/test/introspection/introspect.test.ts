import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { Wait } from "testcontainers";

import { introspect } from "../../src/introspection/index.ts";
import { parseGeneratorMetadata } from "../../src/types.ts";
import type { GeneratorMetadata } from "../../src/types.ts";

/**
 * Integration coverage for `introspect()` against a real Postgres container,
 * using the same `00-init.sql` / `01-memes.sql` fixtures as postgres-meta.
 *
 * `pg.Pool` is passed directly as the `Queryable` — it satisfies the structural
 * interface and returns int8 columns as strings, exercising `normalize.ts`.
 */
const FIXTURE_DIR = join(import.meta.dir, "fixtures");
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

let container: StartedPostgreSqlContainer;
let pool: Pool;
let full: GeneratorMetadata;
let onlyPublic: GeneratorMetadata;
let excludingPublic: GeneratorMetadata;

beforeAll(async () => {
  // The fixtures reference the `postgres` superuser role, so match it (the
  // testcontainers default is `test`).
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("postgres")
    .withPassword("postgres")
    .withDatabase("postgres")
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(120_000)
    .start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await pool.query(readFileSync(join(FIXTURE_DIR, "00-init.sql"), "utf8"));
  await pool.query(readFileSync(join(FIXTURE_DIR, "01-memes.sql"), "utf8"));

  full = await introspect(pool);
  onlyPublic = await introspect(pool, { includedSchemas: ["public"] });
  excludingPublic = await introspect(pool, { excludedSchemas: ["public"] });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

const findTable = (m: GeneratorMetadata, name: string) =>
  m.tables.find((t) => t.schema === "public" && t.name === name);

describe("introspect (integration)", () => {
  test("returns the public schema and excludes system schemas", () => {
    const names = full.schemas.map((s) => s.name);
    expect(names).toContain("public");
    expect(names).not.toContain("pg_catalog");
    expect(names).not.toContain("information_schema");
  });

  test("normalizes int8 ids to numbers while leaving composite column ids as strings", () => {
    const users = findTable(full, "users");
    expect(users).toBeDefined();
    expect(typeof users!.id).toBe("number");

    const idColumn = full.columns.find(
      (c) => c.table_id === users!.id && c.name === "id",
    );
    expect(idColumn).toBeDefined();
    // table_id is int8 → number; the column's composite id stays a "<oid>.<attnum>" string
    expect(typeof idColumn!.table_id).toBe("number");
    expect(typeof idColumn!.id).toBe("string");
    expect(idColumn!.id).toContain(".");
  });

  test("users columns introspect with expected formats/flags", () => {
    const users = findTable(full, "users")!;
    const cols = full.columns
      .filter((c) => c.table_id === users.id)
      .sort(byName)
      .map((c) => ({
        name: c.name,
        format: c.format,
        is_nullable: c.is_nullable,
        is_identity: c.is_identity,
      }));

    expect(cols).toMatchInlineSnapshot(`
      [
        {
          "format": "numeric",
          "is_identity": false,
          "is_nullable": true,
          "name": "decimal",
        },
        {
          "format": "int8",
          "is_identity": true,
          "is_nullable": false,
          "name": "id",
        },
        {
          "format": "text",
          "is_identity": false,
          "is_nullable": true,
          "name": "name",
        },
        {
          "format": "user_status",
          "is_identity": false,
          "is_nullable": true,
          "name": "status",
        },
        {
          "format": "uuid",
          "is_identity": false,
          "is_nullable": true,
          "name": "user_uuid",
        },
      ]
    `);
  });

  test("excludes trigger and event_trigger functions", () => {
    expect(full.functions.some((f) => f.return_type === "trigger")).toBe(false);
    expect(full.functions.some((f) => f.return_type === "event_trigger")).toBe(
      false,
    );
    // the plain `add(integer, integer)` SQL function from 00-init survives
    expect(
      full.functions.some((f) => f.schema === "public" && f.name === "add"),
    ).toBe(true);
  });

  test("includes composite and enum types", () => {
    expect(
      full.types.some(
        (t) =>
          t.schema === "public" &&
          t.name === "user_status" &&
          t.enums.length > 0,
      ),
    ).toBe(true);
    expect(
      full.types.some(
        (t) =>
          t.name === "composite_type_with_array_attribute" &&
          t.attributes.length > 0,
      ),
    ).toBe(true);
  });

  describe("relationships", () => {
    const has = (
      m: GeneratorMetadata,
      relation: string,
      referenced: string,
    ): boolean =>
      m.relationships.some(
        (r) =>
          r.schema === "public" &&
          r.relation === relation &&
          r.referenced_schema === "public" &&
          r.referenced_relation === referenced,
      );

    test("table→table foreign key (todos → users)", () => {
      expect(has(full, "todos", "users")).toBe(true);
    });

    test("view→table expansion (todos_view → users)", () => {
      expect(has(full, "todos_view", "users")).toBe(true);
    });

    test("table→view expansion (todos → users_view)", () => {
      expect(has(full, "todos", "users_view")).toBe(true);
    });

    test("view→view expansion (todos_view → users_view)", () => {
      expect(has(full, "todos_view", "users_view")).toBe(true);
    });
  });

  describe("parseGeneratorMetadata round-trips real introspection output", () => {
    test("RETURNS TABLE functions emit null has_default for their OUT columns", () => {
      const fn = full.functions.find(
        (f) => f.schema === "public" && f.name === "function_returning_table",
      );
      expect(fn).toBeDefined();
      const tableArgs = fn!.args.filter((a) => a.mode === "table");
      expect(tableArgs.length).toBeGreaterThan(0);
      expect(tableArgs.every((a) => a.has_default === null)).toBe(true);
    });

    test("validates without throwing", () => {
      expect(() => parseGeneratorMetadata(full)).not.toThrow();
    });
  });

  describe("schema filters", () => {
    test("includedSchemas restricts to the named schema", () => {
      expect(onlyPublic.schemas.every((s) => s.name === "public")).toBe(true);
      expect(findTable(onlyPublic, "users")).toBeDefined();
    });

    test("excludedSchemas drops the named schema's objects", () => {
      expect(excludingPublic.schemas.some((s) => s.name === "public")).toBe(
        false,
      );
      expect(excludingPublic.tables.every((t) => t.schema !== "public")).toBe(
        true,
      );
      expect(excludingPublic.columns.every((c) => c.schema !== "public")).toBe(
        true,
      );
    });
  });
});
