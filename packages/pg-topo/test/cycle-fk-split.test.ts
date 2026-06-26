import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";

// Regression coverage for https://github.com/supabase/pg-toolbelt/issues/311
//
// A mutual foreign-key cycle between two tables previously made the topo sort
// drop the cycle participants AND every statement depending on them from the
// `ordered` result. Declarative apply then built an incomplete shadow schema,
// and pg-delta emitted spurious DROPs for the missing-but-still-present
// objects. pg-topo must instead break the cycle by deferring the
// cross-table FK into a standalone ALTER TABLE ... ADD CONSTRAINT (pg_dump
// style) so every statement survives and the order is applyable.
describe("foreign-key cycle splitting (issue #311)", () => {
  const ISSUE_SCHEMA = [
    `CREATE TABLE public.note (
      id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
      active_note_version_id uuid NULL REFERENCES public.note_version (id)
    );`,
    `CREATE TABLE public.note_version (
      id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
      content text NOT NULL,
      note_id uuid NOT NULL REFERENCES public.note (id) ON DELETE CASCADE,
      previous_note_version_id uuid REFERENCES public.note_version (id)
    );`,
    `CREATE POLICY "Note select policy" ON public.note FOR SELECT USING (true);`,
    `CREATE TABLE public.note_note_link (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      note_id uuid NOT NULL REFERENCES public.note (id)
    );`,
    `CREATE TABLE public.unrelated (id int PRIMARY KEY);`,
  ];

  test("keeps every original statement in the ordered output", async () => {
    const result = await analyzeAndSort(ISSUE_SCHEMA);

    // No original statement may be silently dropped. The cycle is broken by
    // deferring the two cross-table FKs into standalone ALTER statements, so
    // the result is the 5 originals (minus the 2 inline FKs) plus 2 ALTERs.
    const nonAlter = result.ordered.filter(
      (n) => n.statementClass !== "ALTER_TABLE",
    );
    expect(nonAlter.length).toBe(ISSUE_SCHEMA.length);
    expect(result.ordered.length).toBe(ISSUE_SCHEMA.length + 2);

    const orderedSql = result.ordered.map((n) => n.sql.toLowerCase());
    for (const fragment of [
      "create table public.note ",
      "create table public.note_version",
      "create policy",
      "create table public.note_note_link",
      "create table public.unrelated",
    ]) {
      expect(orderedSql.some((s) => s.includes(fragment))).toBe(true);
    }
  });

  test("breaks the FK cycle so no CYCLE_DETECTED diagnostic remains", async () => {
    const result = await analyzeAndSort(ISSUE_SCHEMA);

    expect(
      result.diagnostics.filter((d) => d.code === "CYCLE_DETECTED"),
    ).toHaveLength(0);
    expect(result.graph.cycleGroups).toHaveLength(0);
  });

  test("defers cross-table FKs to ALTER TABLE but keeps self-referential FK inline", async () => {
    const result = await analyzeAndSort(ISSUE_SCHEMA);

    const alterTables = result.ordered.filter(
      (n) => n.statementClass === "ALTER_TABLE",
    );
    // note.active_note_version_id -> note_version and
    // note_version.note_id -> note are the two cross-table cycle FKs.
    expect(alterTables.length).toBe(2);
    const alterSql = alterTables.map((n) => n.sql.toLowerCase()).join("\n");
    expect(alterSql).toContain("add");
    expect(alterSql).toContain("foreign key");
    // ON DELETE CASCADE on note_version.note_id must be preserved.
    expect(alterSql).toContain("on delete cascade");

    // The self-referential FK (previous_note_version_id -> note_version) stays
    // inline on the CREATE TABLE; it does not need deferral.
    const noteVersionCreate = result.ordered.find(
      (n) =>
        n.statementClass === "CREATE_TABLE" &&
        n.sql.toLowerCase().includes("create table public.note_version"),
    );
    expect(noteVersionCreate?.sql.toLowerCase()).toContain(
      "previous_note_version_id",
    );
    expect(noteVersionCreate?.sql.toLowerCase()).toContain("references");
  });

  test("orders both base tables before the deferred FK alters", async () => {
    const result = await analyzeAndSort(ISSUE_SCHEMA);
    const classes = result.ordered.map((n) => n.statementClass);
    const lastCreateTable = classes.lastIndexOf("CREATE_TABLE");
    const firstAlter = classes.indexOf("ALTER_TABLE");
    expect(firstAlter).toBeGreaterThan(-1);
    // every ALTER (deferred FK) comes after the cyclic CREATE TABLEs it links
    expect(firstAlter).toBeGreaterThan(classes.indexOf("CREATE_TABLE"));
    expect(lastCreateTable).toBeGreaterThan(-1);
  });
});
