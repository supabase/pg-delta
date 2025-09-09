import { describe, expect, test } from "vitest";
import { Procedure } from "../procedure.model.ts";
import { CreateProcedure } from "./procedure.create.ts";

describe("procedure", () => {
  test("create minimal", () => {
    const procedure = new Procedure({
      schema: "public",
      name: "test_procedure",
      kind: "p",
      return_type: "void",
      return_type_schema: "pg_catalog",
      language: "plpgsql",
      security_definer: false,
      volatility: "v",
      parallel_safety: "u",
      is_strict: false,
      leakproof: false,
      returns_set: false,
      argument_count: 0,
      argument_default_count: 0,
      argument_names: null,
      argument_types: null,
      all_argument_types: null,
      argument_modes: null,
      argument_defaults: null,
      source_code: "BEGIN RETURN; END;",
      definition: null,
      binary_path: null,
      sql_body: null,
      config: null,
      owner: "test",
    });

    const change = new CreateProcedure({
      procedure,
    });

    expect(change.serialize()).toBe(
      "CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
    );
  });

  test("create with all options", () => {
    const functionProc = new Procedure({
      schema: "public",
      name: "fn_all",
      kind: "w",
      return_type: "int4",
      return_type_schema: "pg_catalog",
      language: "sql",
      security_definer: true,
      volatility: "i",
      parallel_safety: "s",
      is_strict: true,
      leakproof: true,
      returns_set: true,
      argument_count: 0,
      argument_default_count: 0,
      argument_names: null,
      argument_types: null,
      all_argument_types: null,
      argument_modes: null,
      argument_defaults: null,
      source_code: null,
      binary_path: null,
      sql_body: "SELECT 1",
      definition: null,
      config: ["search_path=public", "work_mem=64MB"],
      owner: "test",
    });

    const change = new CreateProcedure({
      procedure: functionProc,
    });

    expect(change.serialize()).toBe(
      "CREATE FUNCTION public.fn_all() RETURNS SETOF int4 LANGUAGE sql SECURITY DEFINER WINDOW IMMUTABLE PARALLEL SAFE STRICT LEAKPROOF SET search_path=public SET work_mem=64MB AS $$SELECT 1$$",
    );
  });
});
