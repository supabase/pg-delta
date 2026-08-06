/**
 * GRANT / REVOKE clause-boundary wrapping. A long GRANT (e.g. the multi-
 * grantee statements compaction now merges) must wrap the way a human writes
 * it — privileges, `ON <target>`, `TO <grantees>` each on their own line —
 * not at the first privilege comma (the generic wrap), which puts one
 * privilege per line and glues `ON … TO …` onto the last privilege.
 */
import { describe, expect, test } from "bun:test";
import { formatSqlStatements } from "./index.ts";

describe("GRANT/REVOKE clause-boundary wrap", () => {
  test("a long GRANT wraps at ON / TO, not at the first privilege comma", () => {
    const sql = `GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."a-new-table-in-branch-only" TO "anon", "authenticated", "service_role"`;
    expect(formatSqlStatements([sql]).join("\n")).toBe(
      [
        `GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`,
        `  ON TABLE "public"."a-new-table-in-branch-only"`,
        `  TO "anon", "authenticated", "service_role"`,
      ].join("\n"),
    );
  });

  test("WITH GRANT OPTION stays on the grantee line", () => {
    const sql = `GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."a-new-table-in-branch-only" TO "some_role" WITH GRANT OPTION`;
    expect(formatSqlStatements([sql]).join("\n")).toBe(
      [
        `GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`,
        `  ON TABLE "public"."a-new-table-in-branch-only"`,
        `  TO "some_role" WITH GRANT OPTION`,
      ].join("\n"),
    );
  });

  test("a long REVOKE wraps at ON / FROM", () => {
    const sql = `REVOKE DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."a-new-table-in-branch-only" FROM "authenticated"`;
    expect(formatSqlStatements([sql]).join("\n")).toBe(
      [
        `REVOKE DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`,
        `  ON TABLE "public"."a-new-table-in-branch-only"`,
        `  FROM "authenticated"`,
      ].join("\n"),
    );
  });

  test("a short GRANT stays on one line", () => {
    const sql = `GRANT USAGE ON TYPE "app"."mood" TO "app_user"`;
    expect(formatSqlStatements([sql]).join("\n")).toBe(
      `GRANT USAGE ON TYPE "app"."mood" TO "app_user"`,
    );
  });

  test("a long role-membership GRANT (no ON clause) wraps at TO", () => {
    const long = `GRANT "a-role-with-a-particularly-unreasonably-long-name" TO "a-member-with-an-even-longer-unreasonable-name" WITH ADMIN OPTION`;
    expect(formatSqlStatements([long]).join("\n")).toBe(
      [
        `GRANT "a-role-with-a-particularly-unreasonably-long-name"`,
        `  TO "a-member-with-an-even-longer-unreasonable-name" WITH ADMIN OPTION`,
      ].join("\n"),
    );
  });

  test("a column-level GRANT keeps its privilege parens intact", () => {
    const sql = `GRANT SELECT ("a-quite-long-column-name"), UPDATE ("a-quite-long-column-name") ON TABLE "public"."a-new-table-in-branch-only" TO "service_role"`;
    expect(formatSqlStatements([sql]).join("\n")).toBe(
      [
        `GRANT SELECT ("a-quite-long-column-name"), UPDATE ("a-quite-long-column-name")`,
        `  ON TABLE "public"."a-new-table-in-branch-only"`,
        `  TO "service_role"`,
      ].join("\n"),
    );
  });
});
