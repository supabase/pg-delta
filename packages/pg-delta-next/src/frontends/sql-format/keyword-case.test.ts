import { describe, expect, it } from "bun:test";
import { DEFAULT_OPTIONS } from "./constants.ts";
import { applyKeywordCase } from "./keyword-case.ts";
import type { NormalizedOptions } from "./types.ts";

const upperOpts: NormalizedOptions = {
  ...DEFAULT_OPTIONS,
  keywordCase: "upper",
};
const lowerOpts: NormalizedOptions = {
  ...DEFAULT_OPTIONS,
  keywordCase: "lower",
};

describe("applyKeywordCase", () => {
  it("normalizes structural create/function clauses contextually", () => {
    const sql =
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE AS __PGDELTA_PLACEHOLDER_0__";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"create function auth.uid() returns uuid language sql stable security definer parallel safe as __PGDELTA_PLACEHOLDER_0__"`,
    );
  });

  it("normalizes grant/revoke privilege clauses without touching grantee identifiers", () => {
    const sql =
      "REVOKE GRANT OPTION FOR USAGE ON SCHEMA app_schema FROM app_user";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"revoke grant option for usage on schema app_schema from app_user"`,
    );
  });

  it("does not force-case keyword-looking identifiers in COMMENT object targets", () => {
    const sql = "COMMENT ON SCHEMA USAGE IS 'schema comment'";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"comment on schema USAGE is 'schema comment'"`,
    );
  });

  it("does not force-case qualified identifier tokens", () => {
    const sql = "ALTER TABLE public.USAGE ADD COLUMN event_time TIMESTAMPTZ";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"alter table public.USAGE add column event_time TIMESTAMPTZ"`,
    );
  });

  it("normalizes restrictive/safe tokens only in valid contexts", () => {
    const sql =
      "CREATE POLICY p ON t AS RESTRICTIVE FOR DELETE TO authenticated";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"create policy p on t as restrictive for delete to authenticated"`,
    );
  });

  it("normalizes role options in role option context", () => {
    const sql = "ALTER ROLE app_user WITH NOSUPERUSER CREATEDB LOGIN";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"alter role app_user with nosuperuser createdb login"`,
    );
  });

  it("preserves full CHECK clause text", () => {
    const sql =
      "ALTER TABLE public.t ADD CONSTRAINT c CHECK (State IN ('ON','OFF')) NO INHERIT";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"alter table public.t add constraint c check (State IN ('ON','OFF')) no inherit"`,
    );
  });

  it("preserves key=value text in option-list contexts", () => {
    const sql =
      "CREATE COLLATION public.test (LOCALE = 'en_US', DETERMINISTIC = false, provider = icu)";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"create collation public.test (locale = 'en_US', deterministic = false, provider = icu)"`,
    );
  });

  it("preserves definition name/type casing in create lists", () => {
    const sql = "CREATE TABLE public.t (RoleID UUID NOT NULL)";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"create table public.t (RoleID UUID not null)"`,
    );
  });

  it("keeps create-if-not-exists clause keywords caseable", () => {
    const sql = "CREATE TABLE IF NOT EXISTS public.t (id bigint)";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"create table if not exists public.t (id bigint)"`,
    );
  });

  it("fails safe when protected-range parsing is uncertain", () => {
    const sql = "ALTER TABLE t ADD CONSTRAINT c CHECK (foo > 0";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toMatchInlineSnapshot(
      `"ALTER TABLE t ADD CONSTRAINT c CHECK (foo > 0"`,
    );
  });

  it("preserves content inside quoted identifiers, strings, and comments", () => {
    const result = applyKeywordCase(
      `CREATE TABLE "Select" ("from" text DEFAULT 'CREATE TABLE') -- UPDATE`,
      upperOpts,
    );
    expect(result).toMatchInlineSnapshot(
      `"CREATE TABLE "Select" ("from" text DEFAULT 'CREATE TABLE') -- UPDATE"`,
    );
  });
});
