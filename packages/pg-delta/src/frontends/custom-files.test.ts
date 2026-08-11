/**
 * `listCustomFiles` — the library helper frontends use to implement
 * fold-into-migration delivery (docs/architecture/custom-folder.md §7, Phase 2).
 *
 * It is deliberately dumb: discover `_custom/**\/*.sql`, read it, parse the
 * head-of-file directive, and report whether the file has been DELIVERED (a
 * recorded migration, or an explicit `none`). No SQL is interpreted and nothing
 * is executed — a frontend decides what to do with the undelivered ones.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listCustomFiles } from "./custom-files.ts";

function rootWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pgd-customfiles-"));
  for (const [name, body] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  return root;
}

describe("listCustomFiles", () => {
  test("returns only `_custom/**\\/*.sql`, in lexicographic POSIX-relative order", () => {
    const root = rootWith({
      "_custom/b.sql": "select 2;\n",
      "_custom/a.sql": "select 1;\n",
      "_custom/nested/c.sql": "select 3;\n",
      "_custom/README.md": "# not sql\n",
      "schemas/app/t.sql": "create table app.t (id int);\n",
    });
    expect(listCustomFiles(root).map((f) => f.path)).toEqual([
      "_custom/a.sql",
      "_custom/b.sql",
      "_custom/nested/c.sql",
    ]);
  });

  test("returns an empty list when the reserved folder does not exist", () => {
    expect(listCustomFiles(rootWith({ "schemas/x.sql": "select 1;\n" }))).toEqual(
      [],
    );
  });

  test("carries the file body verbatim", () => {
    const body = "-- pgdelta-migration: none\ncreate cast (text as int) with inout;\n";
    const root = rootWith({ "_custom/casts.sql": body });
    expect(listCustomFiles(root)[0]?.sql).toBe(body);
  });

  test("a file with recorded migrations is delivered", () => {
    const root = rootWith({
      "_custom/casts.sql":
        "-- pgdelta-migration: ../migrations/1.sql\n-- pgdelta-migration: ../migrations/2.sql\n\nselect 1;\n",
    });
    const [f] = listCustomFiles(root);
    expect(f?.migrations).toEqual(["../migrations/1.sql", "../migrations/2.sql"]);
    expect(f?.hasNone).toBe(false);
    expect(f?.delivered).toBe(true);
  });

  test("an explicit `none` counts as delivered (deliberately no twin)", () => {
    const root = rootWith({
      "_custom/seed.sql": "-- pgdelta-migration: none\nselect 1;\n",
    });
    const [f] = listCustomFiles(root);
    expect(f?.migrations).toEqual([]);
    expect(f?.hasNone).toBe(true);
    expect(f?.delivered).toBe(true);
  });

  test("a file with no directive is UNDELIVERED — the fold-in candidate", () => {
    const root = rootWith({
      "_custom/casts.sql": "create cast (text as int) with inout;\n",
    });
    const [f] = listCustomFiles(root);
    expect(f?.migrations).toEqual([]);
    expect(f?.hasNone).toBe(false);
    expect(f?.delivered).toBe(false);
  });
});
