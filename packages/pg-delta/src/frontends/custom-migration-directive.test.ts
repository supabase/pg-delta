/**
 * The `-- pgdelta-migration:` head-of-file directive
 * (docs/architecture/custom-folder.md §3).
 *
 * Parsing is LEXICAL: it reads the head comment block (blank lines and `--`
 * comments before the first non-comment content) and never interprets the SQL
 * body — so it stays inside the "Postgres is the only elaborator" invariant.
 * A directive that appears after the first statement is NOT a directive.
 * No DB.
 */
import { describe, expect, test } from "bun:test";
import { parseCustomMigrationDirectives } from "./custom-migration-directive.ts";

describe("parseCustomMigrationDirectives", () => {
  test("collects every directive in the head block, in order", () => {
    const parsed = parseCustomMigrationDirectives(
      "-- pgdelta-migration: ../../supabase/migrations/1_add.sql\n" +
        "-- pgdelta-migration: ../../supabase/migrations/2_alter.sql\n" +
        "\n" +
        "create cast (text as public.ltree) with function public.text2ltree(text);\n",
    );
    expect(parsed.paths).toEqual([
      "../../supabase/migrations/1_add.sql",
      "../../supabase/migrations/2_alter.sql",
    ]);
    expect(parsed.hasNone).toBe(false);
  });

  test("tolerates blank lines, unrelated comments, CRLF and spacing variants", () => {
    const parsed = parseCustomMigrationDirectives(
      "\r\n" +
        "-- why this file exists\r\n" +
        "--pgdelta-migration:   ./m/1.sql   \r\n" +
        "--   PGDelta-Migration : ./m/2.sql\r\n" +
        "\r\n" +
        "create operator public.=== (leftarg = text, rightarg = text, procedure = texteq);\r\n",
    );
    expect(parsed.paths).toEqual(["./m/1.sql", "./m/2.sql"]);
  });

  test("recognizes the `none` opt-out (case-insensitively) and keeps it out of paths", () => {
    const parsed = parseCustomMigrationDirectives(
      "-- pgdelta-migration: none\n\ninsert into public.t (id) values (1) on conflict do nothing;\n",
    );
    expect(parsed.hasNone).toBe(true);
    expect(parsed.paths).toEqual([]);
    expect(parseCustomMigrationDirectives("-- pgdelta-migration: NONE\n").hasNone)
      .toBe(true);
  });

  test("reports `none` mixed with paths so the caller can warn", () => {
    const parsed = parseCustomMigrationDirectives(
      "-- pgdelta-migration: none\n-- pgdelta-migration: ./m/1.sql\n\nselect 1;\n",
    );
    expect(parsed.hasNone).toBe(true);
    expect(parsed.paths).toEqual(["./m/1.sql"]);
  });

  test("ignores a directive that appears AFTER the first statement", () => {
    const parsed = parseCustomMigrationDirectives(
      "create cast (text as public.ltree) with function public.text2ltree(text);\n" +
        "-- pgdelta-migration: ./m/1.sql\n",
    );
    expect(parsed.paths).toEqual([]);
    expect(parsed.hasNone).toBe(false);
  });

  test("an empty directive value is ignored (no phantom path)", () => {
    const parsed = parseCustomMigrationDirectives(
      "-- pgdelta-migration:\n-- pgdelta-migration:   \n\nselect 1;\n",
    );
    expect(parsed.paths).toEqual([]);
    expect(parsed.hasNone).toBe(false);
  });

  test("a file with no head comments at all yields nothing", () => {
    expect(
      parseCustomMigrationDirectives("create schema x;\n"),
    ).toEqual({ paths: [], hasNone: false });
  });
});
