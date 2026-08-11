/**
 * `schema lint` rules for the reserved `_custom/` folder
 * (docs/architecture/custom-folder.md §4). All four are WARNINGS — bookkeeping
 * hygiene, so export/apply never fail on them:
 *
 *   custom_missing_migration_ref     — a custom file records no migration twin
 *   custom_dangling_migration_ref    — a recorded migration path is not on disk
 *   custom_conflicting_migration_ref — `none` mixed with real paths
 *   custom_modeled_kind              — modeled DDL parked in `_custom/`
 *
 * Files OUTSIDE `_custom/` are never linted by these rules. No DB (the
 * modeled-kind rule uses pg-topo, a pure WASM parser).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  lintCustomMigrationRefs,
  lintCustomModeledKinds,
} from "./custom-lint.ts";
import type { SqlFile } from "./load-sql-files.ts";
import { analyzeForShadow } from "./sql-order.ts";

const file = (name: string, sql: string): SqlFile => ({ name, sql });

/** A temp export root with the given relative files written to disk. */
function rootWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pgd-customlint-"));
  for (const [name, body] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  return root;
}

describe("lintCustomMigrationRefs", () => {
  test("warns once per _custom file with no directive, ignoring the managed tree", () => {
    const root = rootWith({});
    const findings = lintCustomMigrationRefs(root, [
      file(
        join("_custom", "casts.sql"),
        "create cast (text as int) without function;\n",
      ),
      file(join("schemas", "app", "t.sql"), "create table app.t (id int);\n"),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("custom_missing_migration_ref");
    expect(findings[0]?.file).toBe(join("_custom", "casts.sql"));
    expect(findings[0]?.message).toContain("pgdelta-migration");
  });

  test("resolves directive paths relative to the custom file's own directory", () => {
    const root = rootWith({
      "migrations/20260811_add_cast.sql": "-- the migration\n",
    });
    const findings = lintCustomMigrationRefs(root, [
      file(
        join("_custom", "nested", "casts.sql"),
        "-- pgdelta-migration: ../../migrations/20260811_add_cast.sql\n\nselect 1;\n",
      ),
    ]);
    expect(findings).toEqual([]);
  });

  test("warns on a directive path that does not exist on disk", () => {
    const root = rootWith({});
    const findings = lintCustomMigrationRefs(root, [
      file(
        join("_custom", "casts.sql"),
        "-- pgdelta-migration: ../migrations/nope.sql\n\nselect 1;\n",
      ),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("custom_dangling_migration_ref");
    expect(findings[0]?.message).toContain("../migrations/nope.sql");
  });

  test("`none` exempts a file from both the missing and dangling rules", () => {
    const root = rootWith({});
    expect(
      lintCustomMigrationRefs(root, [
        file(
          join("_custom", "seed.sql"),
          "-- pgdelta-migration: none\n\ninsert into public.t values (1) on conflict do nothing;\n",
        ),
      ]),
    ).toEqual([]);
  });

  test("warns when `none` is mixed with a path directive", () => {
    const root = rootWith({ "migrations/1.sql": "-- m\n" });
    const findings = lintCustomMigrationRefs(root, [
      file(
        join("_custom", "casts.sql"),
        "-- pgdelta-migration: none\n-- pgdelta-migration: ../migrations/1.sql\n\nselect 1;\n",
      ),
    ]);
    expect(findings.map((f) => f.code)).toEqual([
      "custom_conflicting_migration_ref",
    ]);
  });

  test("an injectable existence probe keeps the rule testable without fs writes", () => {
    const findings = lintCustomMigrationRefs(
      "/nowhere",
      [
        file(
          join("_custom", "casts.sql"),
          "-- pgdelta-migration: ./m.sql\n\nselect 1;\n",
        ),
      ],
      { exists: () => true },
    );
    expect(findings).toEqual([]);
  });
});

describe("lintCustomModeledKinds", () => {
  const analyzeCustom = async (sql: string) =>
    lintCustomModeledKinds(
      (await analyzeForShadow([file(join("_custom", "x.sql"), sql)])).files,
    );

  test("warns on DDL pg-delta models (the duplicate-on-re-export hazard)", async () => {
    const findings = await analyzeCustom(
      "create table public.t (id int);\ncreate view public.v as select id from public.t;\ngrant select on public.t to public;\ncomment on table public.t is 'x';\n",
    );
    expect(findings.map((f) => f.code)).toEqual([
      "custom_modeled_kind",
      "custom_modeled_kind",
      "custom_modeled_kind",
      "custom_modeled_kind",
    ]);
    expect(findings[0]?.message).toContain("CREATE_TABLE");
    expect(findings[0]?.location?.filePath).toBe(join("_custom", "x.sql"));
  });

  test("stays silent on the unmodeled kinds the folder exists for", async () => {
    // casts / operators / text-search objects classify as UNKNOWN in pg-topo and
    // are exactly what `_custom/` is for — warning on them would be nonsense.
    expect(
      await analyzeCustom(
        "create text search configuration public.cfg (copy = pg_catalog.english);\n" +
          "create cast (text as public.ltree) with function public.text2ltree(text);\n",
      ),
    ).toEqual([]);
  });

  test("stays silent on idempotent DML and DO blocks", async () => {
    expect(
      await analyzeCustom(
        "insert into public.t (id) values (1) on conflict do nothing;\n" +
          "delete from public.t where id = 2;\n" +
          "update public.t set id = 3 where id = 1;\n" +
          "do $$ begin perform 1; end $$;\n",
      ),
    ).toEqual([]);
  });

  test("never reports statements outside _custom/", async () => {
    const analyzed = await analyzeForShadow([
      file(join("schemas", "app", "t.sql"), "create table app.t (id int);\n"),
    ]);
    expect(lintCustomModeledKinds(analyzed.files)).toEqual([]);
  });
});
