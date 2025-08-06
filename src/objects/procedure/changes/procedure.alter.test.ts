import { describe, expect, test } from "vitest";
import { Procedure } from "../procedure.model.ts";
import {
  AlterProcedureChangeOwner,
  ReplaceProcedure,
} from "./procedure.alter.ts";

describe.concurrent("procedure", () => {
  describe("alter", () => {
    test("change owner", () => {
      const main = new Procedure({
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
        binary_path: null,
        sql_body: null,
        config: null,
        owner: "old_owner",
      });
      const branch = new Procedure({
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
        binary_path: null,
        sql_body: null,
        config: null,
        owner: "new_owner",
      });

      const change = new AlterProcedureChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure OWNER TO new_owner",
      );
    });

    test("replace procedure", () => {
      const main = new Procedure({
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
        binary_path: null,
        sql_body: null,
        config: null,
        owner: "test",
      });
      const branch = new Procedure({
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: true,
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
        binary_path: null,
        sql_body: null,
        config: null,
        owner: "test",
      });

      const change = new ReplaceProcedure({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP PROCEDURE public.test_procedure;\nCREATE PROCEDURE public.test_procedure() SECURITY DEFINER LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
      );
    });
  });
});
