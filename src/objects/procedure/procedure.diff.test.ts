import { describe, expect, test } from "vitest";
import {
  AlterProcedureChangeOwner,
  AlterProcedureSetConfig,
  AlterProcedureSetLeakproof,
  AlterProcedureSetParallel,
  AlterProcedureSetSecurity,
  AlterProcedureSetStrictness,
  AlterProcedureSetVolatility,
  ReplaceProcedure,
} from "./changes/procedure.alter.ts";
import { CreateProcedure } from "./changes/procedure.create.ts";
import { DropProcedure } from "./changes/procedure.drop.ts";
import { diffProcedures } from "./procedure.diff.ts";
import { Procedure, type ProcedureProps } from "./procedure.model.ts";

const base: ProcedureProps = {
  schema: "public",
  name: "fn1",
  kind: "f",
  return_type: "int4",
  return_type_schema: "pg_catalog",
  language: "sql",
  security_definer: false,
  volatility: "v",
  parallel_safety: "s",
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
  sql_body: null,
  definition: null,
  config: null,
  owner: "o1",
};

describe.concurrent("procedure.diff", () => {
  test("create and drop", () => {
    const p = new Procedure(base);
    const created = diffProcedures({}, { [p.stableId]: p });
    expect(created[0]).toBeInstanceOf(CreateProcedure);
    const dropped = diffProcedures({ [p.stableId]: p }, {});
    expect(dropped[0]).toBeInstanceOf(DropProcedure);
  });

  test("alter owner", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, owner: "o2" });
    const changes = diffProcedures(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureChangeOwner);
  });

  test("replace on non-alterable change", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, language: "plpgsql" });
    const changes = diffProcedures(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceProcedure);
  });

  test("replace when returns_set changes", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, returns_set: true });
    const changes = diffProcedures(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceProcedure);
  });

  test("diff emits alter security when security_definer changes", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, security_definer: true });
    const changes = diffProcedures(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetSecurity);
  });

  test("diff emits config set/reset when config changes", () => {
    const main = new Procedure({ ...base, config: ["search_path=public"] });
    const branch = new Procedure({
      ...base,
      config: ["search_path=pg_temp", "work_mem=64MB"],
    });
    const changes = diffProcedures(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetConfig);
  });

  test("diff emits volatility change", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, volatility: "i" });
    const changes = diffProcedures(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetVolatility);
  });

  test("diff emits strictness change", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, is_strict: true });
    const changes = diffProcedures(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetStrictness);
  });

  test("diff emits leakproof change", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, leakproof: true });
    const changes = diffProcedures(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetLeakproof);
  });

  test("diff emits parallel safety change", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, parallel_safety: "r" });
    const changes = diffProcedures(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetParallel);
  });
});
