import { describe, expect, test } from "vitest";
import { DefaultPrivilegeState } from "../base.default-privileges.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainChangeOwner,
  AlterDomainDropConstraint,
  AlterDomainDropDefault,
  AlterDomainDropNotNull,
  AlterDomainSetDefault,
  AlterDomainSetNotNull,
  AlterDomainValidateConstraint,
} from "./changes/domain.alter.ts";
import { CreateDomain } from "./changes/domain.create.ts";
import { DropDomain } from "./changes/domain.drop.ts";
import { diffDomains } from "./domain.diff.ts";
import { Domain, type DomainProps } from "./domain.model.ts";

const base: DomainProps = {
  schema: "public",
  name: "d1",
  base_type: "int4",
  base_type_schema: "pg_catalog",
  not_null: false,
  type_modifier: null,
  array_dimensions: null,
  collation: null,
  default_bin: null,
  default_value: null,
  owner: "o1",
  comment: null,
  constraints: [],
  privileges: [],
};

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
};

describe.concurrent("domain.diff", () => {
  test("create and drop", () => {
    const d = new Domain(base);
    const created = diffDomains(testContext, {}, { [d.stableId]: d });
    expect(created[0]).toBeInstanceOf(CreateDomain);
    const dropped = diffDomains(testContext, { [d.stableId]: d }, {});
    expect(dropped[0]).toBeInstanceOf(DropDomain);
  });

  test("create with constraints results in add (+validate if needed) after create", () => {
    const d = new Domain({
      ...base,
      constraints: [
        {
          name: "c_valid",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE > 0",
        },
        {
          name: "c_not_valid",
          validated: false,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE < 100",
        },
      ],
    });

    const created = diffDomains(testContext, {}, { [d.stableId]: d });
    expect(created[0]).toBeInstanceOf(CreateDomain);
    // Expect ADD for both constraints
    expect(created.some((c) => c instanceof AlterDomainAddConstraint)).toBe(
      true,
    );
    // Expect VALIDATE for the unvalidated one
    expect(
      created.some((c) => c instanceof AlterDomainValidateConstraint),
    ).toBe(true);
  });

  test("alter default set/drop and not null set/drop and owner", () => {
    const main = new Domain(base);
    const branch1 = new Domain({ ...base, default_value: "1" });
    const changes1 = diffDomains(
      testContext,
      { [main.stableId]: main },
      { [branch1.stableId]: branch1 },
    );
    expect(changes1[0]).toBeInstanceOf(AlterDomainSetDefault);

    const branch2 = new Domain({ ...base, not_null: true });
    const changes2 = diffDomains(
      testContext,
      { [main.stableId]: main },
      { [branch2.stableId]: branch2 },
    );
    expect(changes2[0]).toBeInstanceOf(AlterDomainSetNotNull);

    const branch3 = new Domain({ ...base, owner: "o2" });
    const changes3 = diffDomains(
      testContext,
      { [main.stableId]: main },
      { [branch3.stableId]: branch3 },
    );
    expect(changes3.some((c) => c instanceof AlterDomainChangeOwner)).toBe(
      true,
    );

    const main4 = new Domain({ ...base, default_value: "1" });
    const branch4 = new Domain({ ...base, default_value: null });
    const changes4 = diffDomains(
      testContext,
      { [main4.stableId]: main4 },
      { [branch4.stableId]: branch4 },
    );
    expect(changes4[0]).toBeInstanceOf(AlterDomainDropDefault);

    const main5 = new Domain({ ...base, not_null: true });
    const branch5 = new Domain({ ...base, not_null: false });
    const changes5 = diffDomains(
      testContext,
      { [main5.stableId]: main5 },
      { [branch5.stableId]: branch5 },
    );
    expect(changes5[0]).toBeInstanceOf(AlterDomainDropNotNull);
  });

  test("alter constraint drop+add+validate when branch constraint is not validated", () => {
    const main = new Domain({
      ...base,
      constraints: [
        {
          name: "c_check",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE > 0",
        },
      ],
    });
    const branch = new Domain({
      ...base,
      constraints: [
        {
          name: "c_check",
          validated: false, // changed: not validated
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE >= 0", // changed expression
        },
      ],
    });

    const changes = diffDomains(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes.length).toBe(3);
    expect(changes[0]).toBeInstanceOf(AlterDomainDropConstraint);
    expect(changes[1]).toBeInstanceOf(AlterDomainAddConstraint);
    expect(changes[2]).toBeInstanceOf(AlterDomainValidateConstraint);
  });

  test("alter constraint drop+add without validate when branch constraint is validated", () => {
    const main = new Domain({
      ...base,
      constraints: [
        {
          name: "c_check",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE > 0",
        },
      ],
    });
    const branch = new Domain({
      ...base,
      constraints: [
        {
          name: "c_check",
          validated: true, // remains validated
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE >= 0", // changed expression
        },
      ],
    });

    const changes = diffDomains(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes.length).toBe(2);
    expect(changes[0]).toBeInstanceOf(AlterDomainDropConstraint);
    expect(changes[1]).toBeInstanceOf(AlterDomainAddConstraint);
  });

  test("alter: add new validated constraint produces add only", () => {
    const main = new Domain(base);
    const branch = new Domain({
      ...base,
      constraints: [
        {
          name: "c_new",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE <> ''",
        },
      ],
    });

    const changes = diffDomains(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes.length).toBe(1);
    expect(changes[0]).toBeInstanceOf(AlterDomainAddConstraint);
  });

  test("alter: add new not validated constraint produces add + validate", () => {
    const main = new Domain(base);
    const branch = new Domain({
      ...base,
      constraints: [
        {
          name: "c_new",
          validated: false,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE <> ''",
        },
      ],
    });

    const changes = diffDomains(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes.length).toBe(2);
    expect(changes[0]).toBeInstanceOf(AlterDomainAddConstraint);
    expect(changes[1]).toBeInstanceOf(AlterDomainValidateConstraint);
  });

  test("alter: drop existing constraint produces drop only", () => {
    const main = new Domain({
      ...base,
      constraints: [
        {
          name: "c_drop",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE <> ''",
        },
      ],
    });
    const branch = new Domain({
      ...base,
      constraints: [],
    });

    const changes = diffDomains(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes.length).toBe(1);
    expect(changes[0]).toBeInstanceOf(AlterDomainDropConstraint);
  });
});
