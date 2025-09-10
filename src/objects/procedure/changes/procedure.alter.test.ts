import { describe, expect, test } from "vitest";
import { Procedure, type ProcedureProps } from "../procedure.model.ts";
import {
  AlterProcedureChangeOwner,
  AlterProcedureSetConfig,
  AlterProcedureSetLeakproof,
  AlterProcedureSetParallel,
  AlterProcedureSetSecurity,
  AlterProcedureSetStrictness,
  AlterProcedureSetVolatility,
  ReplaceProcedure,
} from "./procedure.alter.ts";

describe.concurrent("procedure", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<ProcedureProps, "owner"> = {
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
        definition: null,
        config: null,
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({
        ...props,
        owner: "old_owner",
      });
      const branch = new Procedure({
        ...props,
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

    test("change owner (function)", () => {
      const props: Omit<ProcedureProps, "owner"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
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
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition: null,
        config: null,
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({
        ...props,
        owner: "old_owner",
      });
      const branch = new Procedure({
        ...props,
        owner: "new_owner",
      });

      const change = new AlterProcedureChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function OWNER TO new_owner",
      );
    });

    test("replace procedure", () => {
      const props: Omit<ProcedureProps, "security_definer"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
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
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({
        ...props,
        security_definer: false,
      });
      const branch = new Procedure({
        ...props,
        security_definer: true,
      });

      const change = new ReplaceProcedure({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "CREATE OR REPLACE PROCEDURE public.test_procedure() LANGUAGE plpgsql SECURITY DEFINER AS $$BEGIN RETURN; END;$$",
      );
    });

    test("set security definer", () => {
      const props: Omit<ProcedureProps, "security_definer"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
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
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...props, security_definer: false });
      const branch = new Procedure({ ...props, security_definer: true });

      const change = new AlterProcedureSetSecurity({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function SECURITY DEFINER",
      );
    });

    test("unset security definer (invoker)", () => {
      const props: Omit<ProcedureProps, "security_definer"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
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
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...props, security_definer: true });
      const branch = new Procedure({ ...props, security_definer: false });

      const change = new AlterProcedureSetSecurity({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function SECURITY INVOKER",
      );
    });

    test("set and reset config", () => {
      const base: Omit<ProcedureProps, "config"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
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
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, config: ["search_path=public"] });
      const branch = new Procedure({
        ...base,
        config: ["search_path=pg_temp", "work_mem=64MB"],
      });

      const change = new AlterProcedureSetConfig({ main, branch });
      expect(change.serialize()).toBe(
        [
          "ALTER FUNCTION public.test_function RESET search_path",
          "ALTER FUNCTION public.test_function SET search_path TO pg_temp",
          "ALTER FUNCTION public.test_function SET work_mem TO '64MB'",
        ].join(";\n"),
      );
    });

    test("set config from null (function)", () => {
      const base: Omit<ProcedureProps, "config"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
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
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, config: null });
      const branch = new Procedure({ ...base, config: ["search_path=public"] });

      const change = new AlterProcedureSetConfig({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function SET search_path TO public",
      );
    });

    test("set volatility", () => {
      const base: Omit<ProcedureProps, "volatility"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
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
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, volatility: "v" });
      const branch = new Procedure({ ...base, volatility: "i" });
      const change = new AlterProcedureSetVolatility({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function IMMUTABLE",
      );
    });

    test("set strictness", () => {
      const base: Omit<ProcedureProps, "is_strict"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        leakproof: false,
        returns_set: false,
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
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, is_strict: false });
      const branch = new Procedure({ ...base, is_strict: true });
      const change = new AlterProcedureSetStrictness({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function STRICT",
      );
    });

    test("unset strictness (called on null input)", () => {
      const base: Omit<ProcedureProps, "is_strict"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        leakproof: false,
        returns_set: false,
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
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, is_strict: true });
      const branch = new Procedure({ ...base, is_strict: false });
      const change = new AlterProcedureSetStrictness({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function CALLED ON NULL INPUT",
      );
    });

    test("set leakproof", () => {
      const base: Omit<ProcedureProps, "leakproof"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        returns_set: false,
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
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, leakproof: false });
      const branch = new Procedure({ ...base, leakproof: true });
      const change = new AlterProcedureSetLeakproof({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function LEAKPROOF",
      );
    });

    test("unset leakproof", () => {
      const base: Omit<ProcedureProps, "leakproof"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        returns_set: false,
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
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, leakproof: true });
      const branch = new Procedure({ ...base, leakproof: false });
      const change = new AlterProcedureSetLeakproof({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function NOT LEAKPROOF",
      );
    });

    test("set parallel safety", () => {
      const base: Omit<ProcedureProps, "parallel_safety"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
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
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, parallel_safety: "u" });
      const branch = new Procedure({ ...base, parallel_safety: "r" });
      const change = new AlterProcedureSetParallel({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function PARALLEL RESTRICTED",
      );
    });

    // PROCEDURE variants
    test("procedure: set security definer", () => {
      const base: Omit<ProcedureProps, "security_definer"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
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
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, security_definer: false });
      const branch = new Procedure({ ...base, security_definer: true });
      const change = new AlterProcedureSetSecurity({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure SECURITY DEFINER",
      );
    });

    test("procedure: unset security definer (invoker)", () => {
      const base: Omit<ProcedureProps, "security_definer"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
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
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, security_definer: true });
      const branch = new Procedure({ ...base, security_definer: false });
      const change = new AlterProcedureSetSecurity({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure SECURITY INVOKER",
      );
    });

    test("procedure: set and reset config", () => {
      const base: Omit<ProcedureProps, "config"> = {
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
        definition: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, config: ["search_path=public"] });
      const branch = new Procedure({
        ...base,
        config: ["search_path=pg_temp", "work_mem=64MB"],
      });
      const change = new AlterProcedureSetConfig({ main, branch });
      expect(change.serialize()).toBe(
        [
          "ALTER PROCEDURE public.test_procedure RESET search_path",
          "ALTER PROCEDURE public.test_procedure SET search_path TO pg_temp",
          "ALTER PROCEDURE public.test_procedure SET work_mem TO '64MB'",
        ].join(";\n"),
      );
    });

    test("procedure: reset all config (to null)", () => {
      const base: Omit<ProcedureProps, "config"> = {
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
        definition: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({
        ...base,
        config: ["search_path=public", "work_mem=64MB"],
      });
      const branch = new Procedure({ ...base, config: null });

      const change = new AlterProcedureSetConfig({ main, branch });
      expect(change.serialize()).toBe(
        [
          "ALTER PROCEDURE public.test_procedure RESET search_path",
          "ALTER PROCEDURE public.test_procedure RESET work_mem",
        ].join(";\n"),
      );
    });

    test("procedure: set volatility", () => {
      const base: Omit<ProcedureProps, "volatility"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
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
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, volatility: "v" });
      const branch = new Procedure({ ...base, volatility: "s" });
      const change = new AlterProcedureSetVolatility({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure STABLE",
      );
    });

    test("procedure: set strictness", () => {
      const base: Omit<ProcedureProps, "is_strict"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
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
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, is_strict: false });
      const branch = new Procedure({ ...base, is_strict: true });
      const change = new AlterProcedureSetStrictness({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure STRICT",
      );
    });

    test("procedure: unset strictness (called on null input)", () => {
      const base: Omit<ProcedureProps, "is_strict"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
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
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, is_strict: true });
      const branch = new Procedure({ ...base, is_strict: false });
      const change = new AlterProcedureSetStrictness({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure CALLED ON NULL INPUT",
      );
    });

    test("procedure: set leakproof", () => {
      const base: Omit<ProcedureProps, "leakproof"> = {
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
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, leakproof: false });
      const branch = new Procedure({ ...base, leakproof: true });
      const change = new AlterProcedureSetLeakproof({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure LEAKPROOF",
      );
    });

    test("procedure: unset leakproof", () => {
      const base: Omit<ProcedureProps, "leakproof"> = {
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
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, leakproof: true });
      const branch = new Procedure({ ...base, leakproof: false });
      const change = new AlterProcedureSetLeakproof({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure NOT LEAKPROOF",
      );
    });

    test("procedure: set parallel safety", () => {
      const base: Omit<ProcedureProps, "parallel_safety"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
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
        definition: null,
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
      };
      const main = new Procedure({ ...base, parallel_safety: "u" });
      const branch = new Procedure({ ...base, parallel_safety: "s" });
      const change = new AlterProcedureSetParallel({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure PARALLEL SAFE",
      );
    });
  });
});
