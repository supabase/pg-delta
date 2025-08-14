import { describe, expect, test } from "vitest";
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
};

describe.concurrent("domain.diff", () => {
  test("create and drop", () => {
    const d = new Domain(base);
    const created = diffDomains({}, { [d.stableId]: d });
    expect(created[0]).toBeInstanceOf(CreateDomain);
    const dropped = diffDomains({ [d.stableId]: d }, {});
    expect(dropped[0]).toBeInstanceOf(DropDomain);
  });

  test("alter default set/drop and not null set/drop and owner", () => {
    const main = new Domain(base);
    const branch1 = new Domain({ ...base, default_value: "1" });
    const changes1 = diffDomains(
      { [main.stableId]: main },
      { [branch1.stableId]: branch1 },
    );
    expect(changes1[0]).toBeInstanceOf(AlterDomainSetDefault);

    const branch2 = new Domain({ ...base, not_null: true });
    const changes2 = diffDomains(
      { [main.stableId]: main },
      { [branch2.stableId]: branch2 },
    );
    expect(changes2[0]).toBeInstanceOf(AlterDomainSetNotNull);

    const branch3 = new Domain({ ...base, owner: "o2" });
    const changes3 = diffDomains(
      { [main.stableId]: main },
      { [branch3.stableId]: branch3 },
    );
    expect(changes3.some((c) => c instanceof AlterDomainChangeOwner)).toBe(
      true,
    );

    const main4 = new Domain({ ...base, default_value: "1" });
    const branch4 = new Domain({ ...base, default_value: null });
    const changes4 = diffDomains(
      { [main4.stableId]: main4 },
      { [branch4.stableId]: branch4 },
    );
    expect(changes4[0]).toBeInstanceOf(AlterDomainDropDefault);

    const main5 = new Domain({ ...base, not_null: true });
    const branch5 = new Domain({ ...base, not_null: false });
    const changes5 = diffDomains(
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
          owner: base.owner,
        },
      ],
    });
    const branch = new Domain({
      ...base,
      // Trigger altered detection without generating extra ALTER statements
      type_modifier: 1,
      constraints: [
        {
          name: "c_check",
          validated: false, // changed: not validated
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE >= 0", // changed expression
          owner: base.owner,
        },
      ],
    });

    const changes = diffDomains(
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
          owner: base.owner,
        },
      ],
    });
    const branch = new Domain({
      ...base,
      // Trigger altered detection without generating extra ALTER statements
      type_modifier: 1,
      constraints: [
        {
          name: "c_check",
          validated: true, // remains validated
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE >= 0", // changed expression
          owner: base.owner,
        },
      ],
    });

    const changes = diffDomains(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes.length).toBe(2);
    expect(changes[0]).toBeInstanceOf(AlterDomainDropConstraint);
    expect(changes[1]).toBeInstanceOf(AlterDomainAddConstraint);
  });
});
