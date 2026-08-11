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

  test("a directive resolving to a DIRECTORY is dangling, not satisfied", () => {
    // A migration reference names a migration FILE. Mere existence is not
    // enough: `../migrations` (the directory) records nothing about which
    // migration delivered this file, so it must read as a broken reference.
    const root = rootWith({ "migrations/20260811_add_cast.sql": "-- m\n" });
    const findings = lintCustomMigrationRefs(root, [
      file(
        join("_custom", "casts.sql"),
        "-- pgdelta-migration: ../migrations\n\nselect 1;\n",
      ),
    ]);
    expect(findings.map((f) => f.code)).toEqual([
      "custom_dangling_migration_ref",
    ]);
    expect(findings[0]?.message).toContain("../migrations");
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

  test("missingRef: off suppresses ONLY the missing-ref rule", () => {
    const root = rootWith({});
    const files = [
      file(
        join("_custom", "no-ref.sql"),
        "create cast (text as int) without function;\n",
      ),
      file(
        join("_custom", "dangling.sql"),
        "-- pgdelta-migration: ../migrations/nope.sql\n\nselect 1;\n",
      ),
      file(
        join("_custom", "conflicting.sql"),
        "-- pgdelta-migration: none\n-- pgdelta-migration: ../migrations/nope.sql\n\nselect 1;\n",
      ),
    ];
    // default: all three fire
    expect(
      lintCustomMigrationRefs(root, files)
        .map((f) => f.code)
        .sort(),
    ).toEqual([
      "custom_conflicting_migration_ref",
      "custom_dangling_migration_ref",
      "custom_missing_migration_ref",
    ]);
    // off: a recorded-but-WRONG ref is always a bug, so only the missing rule goes
    expect(
      lintCustomMigrationRefs(root, files, { missingRef: "off" })
        .map((f) => f.code)
        .sort(),
    ).toEqual([
      "custom_conflicting_migration_ref",
      "custom_dangling_migration_ref",
    ]);
  });

  test("rejects an absolute path directive even when the file exists on disk", () => {
    // §3 requires paths RELATIVE to the directory containing the custom file.
    // An absolute path happens to survive `resolve(base, value)` unchanged (Node
    // discards `base` for an absolute `value`), so an existing-but-absolute
    // reference must not silently pass as satisfied — it's machine-specific
    // bookkeeping that breaks on any other checkout.
    const root = rootWith({ "migrations/1.sql": "-- m\n" });
    const absoluteMigration = join(root, "migrations", "1.sql");
    const findings = lintCustomMigrationRefs(root, [
      file(
        join("_custom", "casts.sql"),
        `-- pgdelta-migration: ${absoluteMigration}\n\nselect 1;\n`,
      ),
    ]);
    expect(findings.map((f) => f.code)).toEqual([
      "custom_dangling_migration_ref",
    ]);
    expect(findings[0]?.message).toContain(absoluteMigration);
  });

  test("rejects a Windows-style absolute path directive on any platform", () => {
    // On POSIX, backslashes are not separators, so `resolve(base, value)`
    // treats "C:\migrations\x.sql" as a single literal filename inside
    // `_custom/` — create exactly that file so today's (buggy) resolve finds
    // it, proving the drive-letter form must be caught by an explicit check
    // rather than by "does the resolved path exist".
    const root = rootWith({
      [join("_custom", "C:\\migrations\\x.sql")]: "-- decoy\n",
    });
    const findings = lintCustomMigrationRefs(root, [
      file(
        join("_custom", "casts.sql"),
        "-- pgdelta-migration: C:\\migrations\\x.sql\n\nselect 1;\n",
      ),
    ]);
    expect(findings.map((f) => f.code)).toEqual([
      "custom_dangling_migration_ref",
    ]);
    expect(findings[0]?.message).toContain("C:\\migrations\\x.sql");
  });

  test("an injectable file probe keeps the rule testable without fs writes", () => {
    const findings = lintCustomMigrationRefs(
      "/nowhere",
      [
        file(
          join("_custom", "casts.sql"),
          "-- pgdelta-migration: ./m.sql\n\nselect 1;\n",
        ),
      ],
      { isFile: () => true },
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
    // `comment on table` and `grant`/`revoke` are deliberately NOT among them:
    // pg-topo's COMMENT and GRANT classes are target-blind, so flagging them
    // would fire on comments/ACLs about the unmodeled objects this folder
    // exists to hold (see MODELED_STATEMENT_CLASSES).
    const findings = await analyzeCustom(
      "create table public.t (id int);\ncreate view public.v as select id from public.t;\ngrant select on public.t to public;\ncomment on table public.t is 'x';\n",
    );
    expect(findings.map((f) => f.code)).toEqual([
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

  test("stays silent on COMMENT — the class cannot see its target's kind", async () => {
    // `COMMENT ON TEXT SEARCH CONFIGURATION` is legitimate metadata for an
    // UNMODELED object, and pg-topo classifies every COMMENT the same way
    // (target-blind). Warning on the class would fire on the folder's own
    // documented use — a false positive that trains operators to ignore the
    // rule — so the class is excluded and `COMMENT ON TABLE` goes unflagged too.
    expect(
      await analyzeCustom(
        "-- pgdelta-migration: none\n" +
          "comment on text search configuration public.cfg is 'custom parser';\n",
      ),
    ).toEqual([]);
  });

  test("stays silent on GRANT/REVOKE — the class cannot see its target's kind", async () => {
    // Same target-blindness as ALTER_OWNER/COMMENT: pg-topo gives `GRANT USAGE
    // ON LANGUAGE plfoo TO app` (an ACL on the unmodeled CREATE_LANGUAGE
    // object this folder legitimately holds) the same GRANT class as
    // `GRANT SELECT ON TABLE public.t TO app`. Warning on the class would fire
    // on the folder's own documented use, so it is excluded like COMMENT.
    expect(
      await analyzeCustom(
        "-- pgdelta-migration: none\ngrant usage on language plfoo to app;\n",
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
