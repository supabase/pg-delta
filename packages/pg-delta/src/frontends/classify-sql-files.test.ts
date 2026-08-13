/**
 * Pure export-file classification (schema-first CLI enablement WP3a).
 *
 * Compares a proposed `SqlFile[]` against an in-memory existing tree and the
 * previous export's owned-file list. No filesystem mutation: staging, prune
 * authorization, and install stay with the caller (pgdelta CLI / Supabase CLI).
 */
import { describe, expect, test } from "bun:test";
import { classifySqlContent, classifySqlFiles } from "./classify-sql-files.ts";
import type { SqlFile } from "./load-sql-files.ts";

const file = (name: string, sql: string): SqlFile => ({ name, sql });

function existing(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe("classifySqlContent", () => {
  test("absent existing content is created", () => {
    expect(classifySqlContent(undefined, "CREATE TABLE app.t ();\n")).toBe(
      "created",
    );
  });

  test("byte-identical content is unchanged", () => {
    expect(classifySqlContent("-- a\n", "-- a\n")).toBe("unchanged");
  });

  test("different content is updated", () => {
    expect(classifySqlContent("-- a v1\n", "-- a v2\n")).toBe("updated");
  });
});

describe("classifySqlFiles", () => {
  test("classifies created / updated / unchanged across a re-export-shaped input", () => {
    const first = classifySqlFiles({
      proposed: [
        file("schemas/app/a.sql", "-- a v1\n"),
        file("schemas/app/b.sql", "-- b v1\n"),
      ],
      existing: existing({}),
    });
    expect(first.created).toEqual(["schemas/app/a.sql", "schemas/app/b.sql"]);
    expect(first.updated).toEqual([]);
    expect(first.unchanged).toEqual([]);
    expect(first.removed).toEqual([]);
    expect(first.unmanaged).toEqual([]);

    const second = classifySqlFiles({
      proposed: [
        file("schemas/app/a.sql", "-- a v1\n"),
        file("schemas/app/b.sql", "-- b v2\n"),
        file("schemas/app/c.sql", "-- c\n"),
      ],
      existing: existing({
        "schemas/app/a.sql": "-- a v1\n",
        "schemas/app/b.sql": "-- b v1\n",
      }),
      previouslyOwned: new Set(["schemas/app/a.sql", "schemas/app/b.sql"]),
    });
    expect(second.created).toEqual(["schemas/app/c.sql"]);
    expect(second.updated).toEqual(["schemas/app/b.sql"]);
    expect(second.unchanged).toEqual(["schemas/app/a.sql"]);
  });

  test("normalizes separators so Windows-style proposed names match POSIX existing keys", () => {
    const result = classifySqlFiles({
      proposed: [file("schemas\\app\\t.sql", "CREATE TABLE app.t ();\n")],
      existing: existing({
        "schemas/app/t.sql": "CREATE TABLE app.t ();\n",
      }),
    });
    expect(result.unchanged).toEqual(["schemas/app/t.sql"]);
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);
  });

  test("a ./ -prefixed existing key matches the same proposed path", () => {
    const result = classifySqlFiles({
      proposed: [file("schemas/app/t.sql", "CREATE TABLE app.t ();\n")],
      existing: existing({
        "./schemas/app/t.sql": "CREATE TABLE app.t ();\n",
      }),
    });
    expect(result.unchanged).toEqual(["schemas/app/t.sql"]);
    expect(result.created).toEqual([]);
    expect(result.unmanaged).toEqual([]);
  });

  test("./_custom/ is invisible, matching the reserved-folder invariant", () => {
    const result = classifySqlFiles({
      proposed: [file("schemas/app/t.sql", "CREATE TABLE app.t ();\n")],
      existing: existing({
        "schemas/app/t.sql": "CREATE TABLE app.t ();\n",
        "./_custom/x.sql": "-- custom\n",
      }),
    });
    expect(result.unchanged).toEqual(["schemas/app/t.sql"]);
    expect(result.unmanaged).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  test("a previously-owned file missing from proposed is removed", () => {
    const result = classifySqlFiles({
      proposed: [file("schemas/app/t.sql", "CREATE TABLE app.t ();\n")],
      existing: existing({
        "schemas/app/t.sql": "CREATE TABLE app.t ();\n",
        "schemas/app/gone.sql": "-- gone\n",
      }),
      previouslyOwned: new Set(["schemas/app/t.sql", "schemas/app/gone.sql"]),
    });
    expect(result.removed).toEqual(["schemas/app/gone.sql"]);
    expect(result.unmanaged).toEqual([]);
    expect(result.unchanged).toEqual(["schemas/app/t.sql"]);
  });

  test("a never-owned extra .sql is unmanaged (not removed)", () => {
    const result = classifySqlFiles({
      proposed: [file("schemas/app/t.sql", "CREATE TABLE app.t ();\n")],
      existing: existing({
        "schemas/app/handwritten.sql": "-- hand-authored\n",
      }),
      previouslyOwned: new Set(),
    });
    expect(result.removed).toEqual([]);
    expect(result.unmanaged).toEqual(["schemas/app/handwritten.sql"]);
  });

  test("absent previouslyOwned treats every extra .sql as unmanaged (pre-feature dir)", () => {
    const result = classifySqlFiles({
      proposed: [file("schemas/app/t.sql", "CREATE TABLE app.t ();\n")],
      existing: existing({
        "schemas/app/t.sql": "CREATE TABLE app.t ();\n",
        "legacy.sql": "-- leftover\n",
      }),
    });
    expect(result.removed).toEqual([]);
    expect(result.unmanaged).toEqual(["legacy.sql"]);
    expect(result.unchanged).toEqual(["schemas/app/t.sql"]);
  });

  test("a previously-owned path not present in existing is not removed", () => {
    const result = classifySqlFiles({
      proposed: [file("schemas/app/t.sql", "CREATE TABLE app.t ();\n")],
      existing: existing({
        "schemas/app/t.sql": "CREATE TABLE app.t ();\n",
      }),
      previouslyOwned: new Set([
        "schemas/app/t.sql",
        "schemas/app/already-gone.sql",
      ]),
    });
    expect(result.removed).toEqual([]);
    expect(result.unmanaged).toEqual([]);
  });

  test("_custom/** is neither removed nor unmanaged", () => {
    const result = classifySqlFiles({
      proposed: [file("schemas/app/t.sql", "CREATE TABLE app.t ();\n")],
      existing: existing({
        "schemas/app/t.sql": "CREATE TABLE app.t ();\n",
        "_custom/text-search.sql": "-- custom\n",
        "_custom/nested/seed.sql": "-- seed\n",
      }),
      previouslyOwned: new Set([
        "schemas/app/t.sql",
        "_custom/text-search.sql",
      ]),
    });
    expect(result.removed).toEqual([]);
    expect(result.unmanaged).toEqual([]);
    expect(result.unchanged).toEqual(["schemas/app/t.sql"]);
  });

  test("a proposed _custom/ path is ignored (exporter never claims the reserved folder)", () => {
    const result = classifySqlFiles({
      proposed: [
        file("_custom/t.sql", "CREATE TABLE app.t ();\n"),
        file("schemas/app/t.sql", "CREATE TABLE app.t ();\n"),
      ],
      existing: existing({}),
    });
    expect(result.created).toEqual(["schemas/app/t.sql"]);
    expect(result.updated).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  test("a nested schemas/app/_custom/ path is ordinary managed space", () => {
    const result = classifySqlFiles({
      proposed: [],
      existing: existing({
        "schemas/app/_custom/x.sql": "-- nested\n",
      }),
    });
    expect(result.unmanaged).toEqual(["schemas/app/_custom/x.sql"]);
    expect(result.removed).toEqual([]);
  });

  test("non-.sql existing entries are ignored", () => {
    const result = classifySqlFiles({
      proposed: [file("schemas/app/t.sql", "CREATE TABLE app.t ();\n")],
      existing: existing({
        "README.md": "# notes\n",
        ".pgdelta-export.json": "{}\n",
      }),
    });
    expect(result.unmanaged).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.created).toEqual(["schemas/app/t.sql"]);
  });

  test("empty proposed against an empty tree is a no-op classification", () => {
    expect(classifySqlFiles({ proposed: [], existing: existing({}) })).toEqual({
      created: [],
      updated: [],
      unchanged: [],
      removed: [],
      unmanaged: [],
    });
  });
});
