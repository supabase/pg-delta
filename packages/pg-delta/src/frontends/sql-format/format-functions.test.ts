import { describe, expect, test } from "bun:test";
import { formatSqlStatements } from "./index.ts";

describe("function formatting", () => {
  test("single unnamed param, RETURNS void", () => {
    const sql = `CREATE FUNCTION public.drop_table(regclass) RETURNS void LANGUAGE sql AS $function$SELECT 1$function$;`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE FUNCTION public.drop_table (
        regclass
      )
        RETURNS void
        LANGUAGE sql
        AS $function$SELECT 1$function$"
    `);
  });

  test("named param, RETURNS text[], STABLE + SECURITY DEFINER", () => {
    const sql = `CREATE FUNCTION public.get_tags(p_id uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER AS $function$SELECT ARRAY['a','b']$function$;`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE FUNCTION public.get_tags (
        p_id uuid
      )
        RETURNS text[]
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        AS $function$SELECT ARRAY['a','b']$function$"
    `);
  });

  test("multiple named params with alignment, RETURNS uuid", () => {
    const sql = `CREATE FUNCTION audit.to_record_id(entity_oid oid, pkey_cols text[], rec jsonb) RETURNS uuid LANGUAGE sql STABLE AS $function$SELECT gen_random_uuid()$function$;`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE FUNCTION audit.to_record_id (
        entity_oid oid,
        pkey_cols  text[],
        rec        jsonb
      )
        RETURNS uuid
        LANGUAGE sql
        STABLE
        AS $function$SELECT gen_random_uuid()$function$"
    `);
  });

  test("no params, RETURNS trigger", () => {
    const sql = `CREATE FUNCTION public.audit_trigger() RETURNS trigger LANGUAGE plpgsql AS $function$BEGIN RETURN NEW; END;$function$;`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE FUNCTION public.audit_trigger()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$BEGIN RETURN NEW; END;$function$"
    `);
  });

  test("no params, RETURNS trigger (second)", () => {
    const sql = `CREATE FUNCTION public.notify_change() RETURNS trigger LANGUAGE plpgsql AS $function$BEGIN PERFORM pg_notify('change', ''); RETURN NEW; END;$function$;`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE FUNCTION public.notify_change()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$BEGIN PERFORM pg_notify('change', ''); RETURN NEW; END;$function$"
    `);
  });

  test("many named params with custom types and DEFAULTs", () => {
    const sql = `CREATE FUNCTION auth.can(_organization_id bigint, _project_id bigint, _resource text, _action auth.action, _data json DEFAULT NULL::json, _subject_id uuid DEFAULT auth.gotrue_id()) RETURNS boolean LANGUAGE sql STABLE AS $function$SELECT true$function$;`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE FUNCTION auth.can (
        _organization_id bigint,
        _project_id      bigint,
        _resource        text,
        _action          auth.action,
        _data            json        DEFAULT NULL::json,
        _subject_id      uuid        DEFAULT auth.gotrue_id()
      )
        RETURNS boolean
        LANGUAGE sql
        STABLE
        AS $function$SELECT true$function$"
    `);
  });

  test("NOT LEAKPROOF kept together as compound clause", () => {
    const sql = `CREATE FUNCTION public.safe_fn() RETURNS void LANGUAGE sql NOT LEAKPROOF AS $function$SELECT 1$function$;`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE FUNCTION public.safe_fn()
        RETURNS void
        LANGUAGE sql
        NOT LEAKPROOF
        AS $function$SELECT 1$function$"
    `);
  });

  test("LEAKPROOF without NOT still works", () => {
    const sql = `CREATE FUNCTION public.leak_fn() RETURNS void LANGUAGE sql LEAKPROOF AS $function$SELECT 1$function$;`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE FUNCTION public.leak_fn()
        RETURNS void
        LANGUAGE sql
        LEAKPROOF
        AS $function$SELECT 1$function$"
    `);
  });

  test("CALLED ON NULL INPUT stays together", () => {
    const sql = `CREATE FUNCTION public.null_fn(x integer) RETURNS integer LANGUAGE sql CALLED ON NULL INPUT AS $function$SELECT x$function$;`;
    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE FUNCTION public.null_fn (
        x integer
      )
        RETURNS integer
        LANGUAGE sql
        CALLED ON NULL INPUT
        AS $function$SELECT x$function$"
    `);
  });

  test("BEGIN ATOMIC body is not shredded into separate statements", () => {
    // A SQL-standard function body has bare, unquoted statement-separating
    // semicolons. Formatting must keep it as ONE statement (no extra outputs,
    // no per-fragment trailing semicolons) or the export is invalid SQL.
    const sql =
      "CREATE FUNCTION public.two_steps() RETURNS integer LANGUAGE sql\n" +
      "BEGIN ATOMIC\n SELECT 1;\n SELECT 2;\nEND";
    const results = formatSqlStatements([sql]);
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("BEGIN ATOMIC");
    expect(results[0]).toContain("SELECT 1;");
    expect(results[0]).toContain("SELECT 2;");
    expect(results[0]).toContain("END");
  });
});
