import { describe, expect, test } from "vitest";
import {
  AlterCollationChangeOwner,
  AlterCollationRefreshVersion,
} from "./changes/collation.alter.ts";
import { CreateCollation } from "./changes/collation.create.ts";
import { DropCollation } from "./changes/collation.drop.ts";
import { diffCollations } from "./collation.diff.ts";
import { Collation, type CollationProps } from "./collation.model.ts";

describe.concurrent("collation.diff", () => {
  test("create and drop", () => {
    const props: CollationProps = {
      schema: "public",
      name: "c1",
      provider: "c",
      is_deterministic: true,
      encoding: 1,
      collate: "en_US",
      ctype: "en_US",
      locale: "en_US",
      icu_rules: null,
      version: "1.0",
      owner: "postgres",
      comment: null,
    };
    const c = new Collation(props);

    const created = diffCollations(
      { currentUser: "postgres" },
      {},
      { [c.stableId]: c },
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toBeInstanceOf(CreateCollation);

    const dropped = diffCollations(
      { currentUser: "postgres" },
      { [c.stableId]: c },
      {},
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toBeInstanceOf(DropCollation);
  });

  test("alter: refresh version and change owner", () => {
    const base: Omit<CollationProps, "version" | "owner"> = {
      schema: "public",
      name: "c1",
      provider: "c",
      is_deterministic: true,
      encoding: 1,
      collate: "en_US",
      ctype: "en_US",
      locale: "en_US",
      icu_rules: null,
      comment: null,
    };
    const main = new Collation({ ...base, version: "1.0", owner: "o1" });
    const branch = new Collation({ ...base, version: "2.0", owner: "o2" });

    const changes = diffCollations(
      { currentUser: "postgres" },
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterCollationRefreshVersion)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterCollationChangeOwner)).toBe(
      true,
    );
  });

  test("drop + create when non-alterable changes", () => {
    const base: Omit<CollationProps, "provider"> = {
      schema: "public",
      name: "c1",
      is_deterministic: true,
      encoding: 1,
      collate: "en_US",
      ctype: "en_US",
      locale: "en_US",
      icu_rules: null,
      comment: null,
      version: "1.0",
      owner: "o1",
    };
    const main = new Collation({ ...base, provider: "c" });
    const branch = new Collation({ ...base, provider: "i" });
    const changes = diffCollations(
      { currentUser: "postgres" },
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(DropCollation);
    expect(changes[1]).toBeInstanceOf(CreateCollation);
  });
});
