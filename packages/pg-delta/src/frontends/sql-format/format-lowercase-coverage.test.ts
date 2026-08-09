import { describe, expect, test } from "bun:test";
import { formatSqlStatements } from "./index.ts";

describe("lowercase coverage formatting", () => {
  test("normalizes contextual keywords while preserving protected payloads", () => {
    const statements = [
      "CREATE EVENT TRIGGER prevent_drop ON sql_drop WHEN TAG IN ('DROP TABLE', 'DROP SCHEMA') EXECUTE FUNCTION public.prevent_drop_fn();",
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid$function$;",
      "COMMENT ON FUNCTION public.fn() IS E'line 1 \\' still quoted\\nline 2';",
      "CREATE COLLATION public.test (LOCALE = 'en_US', DETERMINISTIC = false, provider = icu);",
    ];

    const formatted = formatSqlStatements(statements, {
      keywordCase: "lower",
      maxWidth: 140,
    });

    const normalized = [formatted[0]!, formatted[1]!, formatted[3]!].map(
      (value) => value.replace(/\s+/g, " ").trim(),
    );
    expect(normalized).toMatchInlineSnapshot(`
      [
        "create event trigger prevent_drop on sql_drop when tag in ('DROP TABLE', 'DROP SCHEMA') execute function public.prevent_drop_fn()",
        "create function auth.uid() returns uuid language sql stable AS $function$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid$function$",
        "create collation public.test ( locale = 'en_US', deterministic = false, provider = icu )",
      ]
    `);

    expect(formatted[2]).toMatchInlineSnapshot(
      `"comment on function public.fn() is E'line 1 \\' still quoted\\nline 2'"`,
    );
  });

  test("fails safe: malformed protected literals skip casing but still wrap", () => {
    const statements = [
      "COMMENT ON FUNCTION public.fn() IS E'unterminated \\'",
      "ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;",
    ];

    const formatted = formatSqlStatements(statements, {
      keywordCase: "lower",
      maxWidth: 40,
    });

    // Malformed statement: casing skipped (stays uppercase) but wrapping still applies
    expect(formatted[0]!.replace(/\s+/g, " ").trim()).toMatchInlineSnapshot(
      `"COMMENT ON FUNCTION public.fn() IS E'unterminated \\'"`,
    );

    expect(formatted[1]!.replace(/\s+/g, " ").trim()).toMatchInlineSnapshot(
      `"alter table auth.audit_log_entries enable row level security"`,
    );
  });

  test("a QUOTED object name does not shield the following keyword from casing", () => {
    // quoted identifiers produce no scanner token, so the object-name
    // heuristic used to mark the NEXT word (ENABLE / ON) as the "name" and
    // protect it from casing — the middleware dogfood surfaced this on every
    // quoted-relation ALTER and CREATE POLICY.
    const formatted = formatSqlStatements(
      [
        `ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;`,
        `CREATE POLICY "p_sel" ON "public"."users" FOR SELECT TO "authenticated" USING (true);`,
      ],
      { keywordCase: "lower" },
    );
    const normalized = formatted.map((v) => v.replace(/\s+/g, " ").trim());
    expect(normalized[0]).toBe(
      `alter table "public"."users" enable row level security`,
    );
    expect(normalized[1]).toBe(
      `create policy "p_sel" on "public"."users" for select to "authenticated" using (true)`,
    );
  });

  test("privilege + index-ordering vocabulary lower-cases (MAINTAIN, TRUNCATE, DESC, NULLS LAST)", () => {
    const formatted = formatSqlStatements(
      [
        `GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."t" TO "r";`,
        `CREATE INDEX t_a_idx ON public.t USING btree (a DESC NULLS LAST);`,
      ],
      { keywordCase: "lower" },
    );
    const normalized = formatted.map((v) => v.replace(/\s+/g, " ").trim());
    expect(normalized[0]).toContain(
      "grant delete, insert, maintain, references, select, trigger, truncate, update",
    );
    expect(normalized[1]).toContain("(a desc nulls last)");
  });

  test("lowercases all ALTER DEFAULT PRIVILEGES object-type keywords", () => {
    const statements = [
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_user IN SCHEMA public GRANT ALL ON TABLES TO app_reader;",
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_user GRANT ALL ON SEQUENCES TO app_reader;",
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_user GRANT ALL ON ROUTINES TO PUBLIC;",
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_user GRANT ALL ON TYPES TO PUBLIC;",
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_user IN SCHEMA api GRANT ALL ON SCHEMAS TO app_admin;",
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_user REVOKE ALL ON SEQUENCES FROM app_reader;",
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_user REVOKE ALL ON TYPES FROM PUBLIC;",
    ];

    const formatted = formatSqlStatements(statements, {
      keywordCase: "lower",
    });

    const normalized = formatted.map((v) => v.replace(/\s+/g, " ").trim());
    expect(normalized).toMatchInlineSnapshot(`
      [
        "alter default privileges for role app_user in schema public grant all on tables to app_reader",
        "alter default privileges for role app_user grant all on sequences to app_reader",
        "alter default privileges for role app_user grant all on routines to public",
        "alter default privileges for role app_user grant all on types to public",
        "alter default privileges for role app_user in schema api grant all on schemas to app_admin",
        "alter default privileges for role app_user revoke all on sequences from app_reader",
        "alter default privileges for role app_user revoke all on types from public",
      ]
    `);
  });

  test("lowercases PUBLIC in standalone GRANT/REVOKE statements", () => {
    const statements = [
      "GRANT ALL ON SCHEMA public TO PUBLIC;",
      "GRANT EXECUTE ON FUNCTION public.my_fn() TO PUBLIC;",
      "REVOKE ALL ON SCHEMA public FROM PUBLIC;",
      "GRANT USAGE ON TYPE public.my_type TO PUBLIC;",
    ];

    const formatted = formatSqlStatements(statements, {
      keywordCase: "lower",
    });

    const normalized = formatted.map((v) => v.replace(/\s+/g, " ").trim());
    expect(normalized).toMatchInlineSnapshot(`
      [
        "grant all on schema public to public",
        "grant execute on function public.my_fn() to public",
        "revoke all on schema public from public",
        "grant usage on type public.my_type to public",
      ]
    `);
  });

  test("preserves full CHECK clause text while casing surrounding structure", () => {
    const [formatted] = formatSqlStatements(
      [
        "ALTER TABLE public.t ADD CONSTRAINT c CHECK (State IN ('ON','OFF')) NO INHERIT;",
      ],
      { keywordCase: "lower" },
    );

    expect(formatted!.replace(/\s+/g, " ").trim()).toMatchInlineSnapshot(
      `"alter table public.t add constraint c check (State IN ('ON','OFF')) no inherit"`,
    );
  });
});
