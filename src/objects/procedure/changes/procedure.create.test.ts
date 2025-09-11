import { describe, expect, test } from "vitest";
import { Procedure } from "../procedure.model.ts";
import { CreateProcedure } from "./procedure.create.ts";

describe("procedure", () => {
  test("create", () => {
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
      definition:
        "CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
      binary_path: null,
      sql_body: null,
      config: null,
      owner: "test",
      execution_cost: 0,
      result_rows: 0,
    });

    const change = new CreateProcedure({
      procedure,
    });

    expect(change.serialize()).toBe(
      "CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
    );
  });
});
