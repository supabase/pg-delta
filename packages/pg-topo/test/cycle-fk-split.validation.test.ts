import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { validateAnalyzeResultWithPostgres } from "./support/postgres-validation";

// Docker-backed validation for the FK cycle splitting fix (issue #311).
// Confirms the rewritten statement order actually applies against a real
// PostgreSQL instance with no runtime diagnostics.
describe("foreign-key cycle splitting applies on PostgreSQL (issue #311)", () => {
  test("mutual FK cycle schema applies cleanly", async () => {
    const result = await analyzeAndSort([
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
      `CREATE TABLE public.note_note_link (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        note_id uuid NOT NULL REFERENCES public.note (id)
      );`,
    ]);

    expect(
      result.diagnostics.filter((d) => d.code === "CYCLE_DETECTED"),
    ).toHaveLength(0);

    const validation = await validateAnalyzeResultWithPostgres(result);
    expect(validation.diagnostics).toHaveLength(0);
  }, 120000);
});
