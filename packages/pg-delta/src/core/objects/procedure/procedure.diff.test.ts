import { describe, expect, test } from "bun:test";
import { DefaultPrivilegeState } from "../base.default-privileges.ts";
import {
  AlterProcedureChangeOwner,
  AlterProcedureSetConfig,
  AlterProcedureSetLeakproof,
  AlterProcedureSetParallel,
  AlterProcedureSetSecurity,
  AlterProcedureSetStrictness,
  AlterProcedureSetVolatility,
} from "./changes/procedure.alter.ts";
import { CreateCommentOnProcedure } from "./changes/procedure.comment.ts";
import { CreateProcedure } from "./changes/procedure.create.ts";
import { DropProcedure } from "./changes/procedure.drop.ts";
import {
  GrantProcedurePrivileges,
  RevokeProcedurePrivileges,
} from "./changes/procedure.privilege.ts";
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
  definition:
    "CREATE FUNCTION public.fn1() RETURNS int4 LANGUAGE sql AS $$SELECT NULL::int4$$",
  config: null,
  owner: "o1",
  execution_cost: 0,
  result_rows: 0,
  comment: null,
  privileges: [],
};

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

function procedure(overrides: Partial<ProcedureProps> = {}): Procedure {
  return new Procedure({
    ...base,
    owner: "postgres",
    privileges: [],
    ...overrides,
  });
}

function publicExecutePrivilege() {
  return [{ grantee: "PUBLIC", privilege: "EXECUTE", grantable: false }];
}

function defaultPrivilegesWithPublicExecute(): DefaultPrivilegeState {
  const defaultPrivilegeState = new DefaultPrivilegeState({});
  defaultPrivilegeState.applyGrant("postgres", "f", null, "PUBLIC", [
    { privilege: "EXECUTE", grantable: false },
  ]);
  return defaultPrivilegeState;
}

function defaultPrivilegesWithSchemaRoutineGrant(): DefaultPrivilegeState {
  const defaultPrivilegeState = defaultPrivilegesWithPublicExecute();
  defaultPrivilegeState.applyGrant("postgres", "f", "public", "anon", [
    { privilege: "EXECUTE", grantable: false },
  ]);
  return defaultPrivilegeState;
}

function contextWith(
  overrides: Partial<typeof testContext> & {
    skipDefaultPrivilegeSubtraction?: boolean;
  } = {},
) {
  return {
    ...testContext,
    defaultPrivilegeState: new DefaultPrivilegeState({}),
    ...overrides,
  };
}

function expectPublicRevoke(
  changes: ReturnType<typeof diffProcedures>,
  expectedSql = "REVOKE ALL ON FUNCTION public.fn1() FROM PUBLIC",
): RevokeProcedurePrivileges {
  const revokes = changes.filter(
    (change) => change instanceof RevokeProcedurePrivileges,
  ) as RevokeProcedurePrivileges[];

  expect(revokes).toHaveLength(1);
  expect(revokes[0].grantee).toBe("PUBLIC");
  expect(
    revokes[0].privileges.map(({ privilege, grantable }) => ({
      privilege,
      grantable,
    })),
  ).toEqual([{ privilege: "EXECUTE", grantable: false }]);
  expect(revokes[0].serialize()).toBe(expectedSql);
  return revokes[0];
}

function expectPublicGrant(
  changes: ReturnType<typeof diffProcedures>,
): GrantProcedurePrivileges {
  const grants = changes.filter(
    (change) => change instanceof GrantProcedurePrivileges,
  ) as GrantProcedurePrivileges[];

  expect(grants).toHaveLength(1);
  expect(grants[0].grantee).toBe("PUBLIC");
  expect(
    grants[0].privileges.map(({ privilege, grantable }) => ({
      privilege,
      grantable,
    })),
  ).toEqual([{ privilege: "EXECUTE", grantable: false }]);
  expect(grants[0].serialize()).toBe(
    "GRANT ALL ON FUNCTION public.fn1() TO PUBLIC",
  );
  return grants[0];
}

describe.concurrent("procedure.diff", () => {
  test("create and drop", () => {
    const p = new Procedure(base);
    const created = diffProcedures(testContext, {}, { [p.stableId]: p });
    expect(created[0]).toBeInstanceOf(CreateProcedure);
    const dropped = diffProcedures(testContext, { [p.stableId]: p }, {});
    expect(dropped[0]).toBeInstanceOf(DropProcedure);
  });

  test("alter owner", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, owner: "o2" });
    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureChangeOwner);
  });

  test("diff emits alter security when security_definer changes", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, security_definer: true });
    const changes = diffProcedures(
      testContext,
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
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetConfig);
  });

  test("diff emits volatility change", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, volatility: "i" });
    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetVolatility);
  });

  test("diff emits strictness change", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, is_strict: true });
    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetStrictness);
  });

  test("diff emits leakproof change", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, leakproof: true });
    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetLeakproof);
  });

  test("diff emits parallel safety change", () => {
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, parallel_safety: "r" });
    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterProcedureSetParallel);
  });

  test("create or replace when body-only non-alterable property changes", () => {
    // Changing only the language (or source) is OR-REPLACE-safe: no DROP needed.
    const main = new Procedure(base);
    const branch = new Procedure({
      ...base,
      language: "plpgsql",
      source_code: "BEGIN RETURN 1; END",
    });
    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(CreateProcedure);
    expect((changes[0] as CreateProcedure).orReplace).toBe(true);
  });

  test("drop + create when return type changes", () => {
    // `CREATE OR REPLACE FUNCTION` cannot change the return type.
    const main = new Procedure(base);
    const branch = new Procedure({ ...base, return_type: "text" });
    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(DropProcedure);
    expect(changes[1]).toBeInstanceOf(CreateProcedure);
    expect((changes[1] as CreateProcedure).orReplace).toBe(false);
  });

  test("drop + create when parameter name changes but type is identical", () => {
    // Same argument_types means same stableId (altered path), but
    // `CREATE OR REPLACE` rejects changing an IN parameter's name.
    const main = new Procedure({
      ...base,
      argument_count: 1,
      argument_names: ["p"],
      argument_types: ["int4"],
      all_argument_types: ["int4"],
      argument_modes: ["i"],
    });
    const branch = new Procedure({
      ...base,
      argument_count: 1,
      argument_names: ["renamed"],
      argument_types: ["int4"],
      all_argument_types: ["int4"],
      argument_modes: ["i"],
    });
    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(DropProcedure);
    expect(changes[1]).toBeInstanceOf(CreateProcedure);
    expect((changes[1] as CreateProcedure).orReplace).toBe(false);
  });

  test("drop + create when a parameter default is removed", () => {
    // `CREATE OR REPLACE` rejects removing parameter defaults.
    const main = new Procedure({
      ...base,
      argument_count: 1,
      argument_default_count: 1,
      argument_names: ["p"],
      argument_types: ["int4"],
      all_argument_types: ["int4"],
      argument_modes: ["i"],
      argument_defaults: "0",
    });
    const branch = new Procedure({
      ...base,
      argument_count: 1,
      argument_default_count: 0,
      argument_names: ["p"],
      argument_types: ["int4"],
      all_argument_types: ["int4"],
      argument_modes: ["i"],
      argument_defaults: null,
    });
    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(DropProcedure);
    expect(changes[1]).toBeInstanceOf(CreateProcedure);
    expect((changes[1] as CreateProcedure).orReplace).toBe(false);
  });

  test("create or replace also emits a procedure comment when the comment changes", () => {
    const main = new Procedure(base);
    const branch = new Procedure({
      ...base,
      definition:
        "CREATE FUNCTION public.fn1() RETURNS int4 LANGUAGE sql AS $$SELECT 42::int4$$",
      source_code: "SELECT 42::int4",
      comment: "updated comment",
    });

    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes.some((change) => change instanceof CreateProcedure)).toBe(
      true,
    );
    expect(
      changes.some((change) => change instanceof CreateCommentOnProcedure),
    ).toBe(true);
  });

  test("signature change re-emits comment even when comment itself is unchanged", () => {
    // DROP destroys the old comment, so the new CREATE path must re-emit it.
    const main = new Procedure({ ...base, comment: "hello" });
    const branch = new Procedure({
      ...base,
      return_type: "text",
      comment: "hello",
    });
    const changes = diffProcedures(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((change) => change instanceof DropProcedure)).toBe(
      true,
    );
    expect(
      changes.some((change) => change instanceof CreateCommentOnProcedure),
    ).toBe(true);
  });

  test("create emits PUBLIC EXECUTE revoke when the default is absent in the target", () => {
    const p = procedure();
    const changes = diffProcedures(
      contextWith({
        defaultPrivilegeState: defaultPrivilegesWithPublicExecute(),
      }),
      {},
      { [p.stableId]: p },
    );

    expect(changes[0]).toBeInstanceOf(CreateProcedure);
    expectPublicRevoke(changes);
  });

  test("create emits PUBLIC EXECUTE revoke for procedures as well as functions", () => {
    const p = procedure({
      name: "proc1",
      kind: "p",
      return_type: "void",
      definition:
        "CREATE PROCEDURE public.proc1() LANGUAGE sql AS $$ SELECT 1 $$",
    });
    const changes = diffProcedures(
      contextWith({
        defaultPrivilegeState: defaultPrivilegesWithPublicExecute(),
      }),
      {},
      { [p.stableId]: p },
    );

    expect(changes[0]).toBeInstanceOf(CreateProcedure);
    expectPublicRevoke(
      changes,
      "REVOKE ALL ON PROCEDURE public.proc1() FROM PUBLIC",
    );
  });

  test("create does not emit PUBLIC EXECUTE grant when the target keeps the built-in default", () => {
    const p = procedure({ privileges: publicExecutePrivilege() });
    const changes = diffProcedures(
      contextWith({
        defaultPrivilegeState: defaultPrivilegesWithPublicExecute(),
      }),
      {},
      { [p.stableId]: p },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(CreateProcedure);
  });

  test("create combines global routine defaults with schema-specific routine defaults", () => {
    const p = procedure({ privileges: publicExecutePrivilege() });
    const changes = diffProcedures(
      contextWith({
        defaultPrivilegeState: defaultPrivilegesWithSchemaRoutineGrant(),
      }),
      {},
      { [p.stableId]: p },
    );

    const revokes = changes.filter(
      (change) => change instanceof RevokeProcedurePrivileges,
    ) as RevokeProcedurePrivileges[];

    expect(changes[0]).toBeInstanceOf(CreateProcedure);
    expect(
      changes.some((change) => change instanceof GrantProcedurePrivileges),
    ).toBe(false);
    expect(revokes).toHaveLength(1);
    expect(revokes[0].grantee).toBe("anon");
    expect(revokes[0].serialize()).toBe(
      "REVOKE ALL ON FUNCTION public.fn1() FROM anon",
    );
  });

  test("alter emits PUBLIC EXECUTE revoke when an existing routine removes the built-in default", () => {
    const main = procedure({ privileges: publicExecutePrivilege() });
    const branch = procedure();
    const changes = diffProcedures(
      contextWith(),
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expectPublicRevoke(changes);
  });

  test("alter emits PUBLIC EXECUTE grant when an existing routine restores the built-in default", () => {
    const main = procedure();
    const branch = procedure({ privileges: publicExecutePrivilege() });
    const changes = diffProcedures(
      contextWith(),
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expectPublicGrant(changes);
  });

  test("create after a global default privilege revoke does not emit a redundant routine revoke", () => {
    const p = procedure();
    const changes = diffProcedures(
      contextWith({ defaultPrivilegeState: new DefaultPrivilegeState({}) }),
      {},
      { [p.stableId]: p },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(CreateProcedure);
  });

  test("declarative create does not emit PUBLIC EXECUTE grant when the target keeps the built-in default", () => {
    const p = procedure({ privileges: publicExecutePrivilege() });
    const changes = diffProcedures(
      contextWith({ skipDefaultPrivilegeSubtraction: true }),
      {},
      { [p.stableId]: p },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(CreateProcedure);
  });

  test("declarative create emits PUBLIC EXECUTE revoke when the target removes the built-in default", () => {
    const p = procedure();
    const changes = diffProcedures(
      contextWith({ skipDefaultPrivilegeSubtraction: true }),
      {},
      { [p.stableId]: p },
    );

    expect(changes[0]).toBeInstanceOf(CreateProcedure);
    expectPublicRevoke(changes);
  });
});
