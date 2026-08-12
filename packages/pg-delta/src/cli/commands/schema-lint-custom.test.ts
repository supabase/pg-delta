/**
 * `pgdelta schema lint --dir` surfaces the `_custom/` bookkeeping rules
 * (docs/architecture/custom-folder.md §4) alongside the pg-topo findings, all as
 * non-blocking WARNINGs — hygiene must never fail a lint that has no real
 * authoring bug. Pure static analysis: no database (pg-topo is a WASM parser).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UsageError } from "../flags.ts";
import { cmdSchemaLint } from "./schema.ts";

let root: string;
let stderr: string;
const realWrite = process.stderr.write.bind(process.stderr);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pgd-lint-custom-"));
  stderr = "";
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderr +=
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
});
afterEach(() => {
  process.stderr.write = realWrite;
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, body: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, "utf8");
}

/** How many lint lines carry `code`. */
function count(code: string): number {
  return stderr.split("\n").filter((line) => line.includes(`[${code}]`)).length;
}

describe("schema lint: _custom/ rules", () => {
  test("reports missing / dangling / conflicting refs and modeled DDL as warnings", async () => {
    write("schemas/app/schema.sql", "create schema app;\n");
    write("schemas/app/t.sql", "create table app.t (id int);\n");
    write(
      "_custom/no-ref.sql",
      "create cast (text as int) without function;\n",
    );
    write(
      "_custom/dangling.sql",
      "-- pgdelta-migration: ../migrations/missing.sql\ncreate operator public.### (leftarg = text, rightarg = text, procedure = texteq);\n",
    );
    write(
      "_custom/conflicting.sql",
      "-- pgdelta-migration: none\n-- pgdelta-migration: ../migrations/missing.sql\nselect 1;\n",
    );
    write(
      "_custom/modeled.sql",
      "-- pgdelta-migration: none\ncreate table public.parked (id int);\n",
    );

    // non-blocking: hygiene warnings must not throw (CliExit) or fail the lint
    await cmdSchemaLint(["--dir", root]);

    expect(stderr).toContain(
      `WARNING [custom_missing_migration_ref] ${join("_custom", "no-ref.sql")}`,
    );
    expect(count("custom_missing_migration_ref")).toBe(1); // never the managed tree
    expect(stderr).toContain("WARNING [custom_dangling_migration_ref]");
    expect(stderr).toContain("../migrations/missing.sql");
    expect(count("custom_dangling_migration_ref")).toBe(1);
    expect(count("custom_conflicting_migration_ref")).toBe(1);
    expect(stderr).toContain("WARNING [custom_modeled_kind]");
    expect(stderr).toContain("CREATE_TABLE");
    expect(count("custom_modeled_kind")).toBe(1);
    expect(stderr).toMatch(/0 error\(s\)/);
  });

  test("a `_custom/` file with a resolvable migration ref raises none of the custom rules", async () => {
    write("schemas/app/schema.sql", "create schema app;\n");
    write("migrations/20260811_add_cast.sql", "-- the migration\n");
    write(
      "_custom/casts.sql",
      "-- pgdelta-migration: ../migrations/20260811_add_cast.sql\ncreate cast (text as int) without function;\n",
    );
    await cmdSchemaLint(["--dir", root]);
    expect(count("custom_missing_migration_ref")).toBe(0);
    expect(count("custom_dangling_migration_ref")).toBe(0);
    expect(count("custom_conflicting_migration_ref")).toBe(0);
    expect(count("custom_modeled_kind")).toBe(0);
    expect(stderr).toMatch(/0 error\(s\)|No issues found/);
  });

  test("--custom-migration-refs off silences the missing-ref rule only", async () => {
    write("schemas/app/schema.sql", "create schema app;\n");
    write(
      "_custom/no-ref.sql",
      "create cast (text as int) without function;\n",
    );
    write(
      "_custom/dangling.sql",
      "-- pgdelta-migration: ../migrations/missing.sql\nselect 1;\n",
    );

    await cmdSchemaLint(["--dir", root, "--custom-migration-refs", "off"]);

    // a frontend that maintains the directive itself owns the missing case …
    expect(count("custom_missing_migration_ref")).toBe(0);
    // … but a recorded-but-wrong reference is always a bug
    expect(count("custom_dangling_migration_ref")).toBe(1);
  });

  test("--custom-migration-refs warn is the default behavior", async () => {
    write(
      "_custom/no-ref.sql",
      "create cast (text as int) without function;\n",
    );
    await cmdSchemaLint(["--dir", root, "--custom-migration-refs", "warn"]);
    expect(count("custom_missing_migration_ref")).toBe(1);
  });

  test("--custom-migration-refs rejects an unknown value", async () => {
    write(
      "_custom/no-ref.sql",
      "create cast (text as int) without function;\n",
    );
    let error: unknown;
    try {
      await cmdSchemaLint(["--dir", root, "--custom-migration-refs", "nope"]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toMatch(
      /--custom-migration-refs must be warn or off/,
    );
  });

  test("suppresses UNKNOWN_STATEMENT_CLASS inside _custom/ but keeps it outside", async () => {
    write("schemas/app/schema.sql", "create schema app;\n");
    write(
      "_custom/casts.sql",
      "-- pgdelta-migration: none\ncreate cast (text as integer) with inout;\n",
    );
    write(
      "schemas/app/stray-cast.sql",
      "create cast (text as integer) with inout;\n",
    );

    await cmdSchemaLint(["--dir", root]);

    // the _custom/ occurrence is suppressed; the managed-tree occurrence still warns
    expect(count("UNKNOWN_STATEMENT_CLASS")).toBe(1);
    expect(stderr).toContain(join("schemas", "app", "stray-cast.sql"));
    expect(stderr).not.toContain(join("_custom", "casts.sql"));
  });
});
