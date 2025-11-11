import { describe, expect, test } from "vitest";
import { Publication } from "../publication.model.ts";
import { DropPublication } from "./publication.drop.ts";

type PublicationProps = ConstructorParameters<typeof Publication>[0];

const base: PublicationProps = {
  name: "pub_drop_me",
  owner: "owner1",
  comment: null,
  all_tables: true,
  publish_insert: true,
  publish_update: true,
  publish_delete: true,
  publish_truncate: true,
  publish_via_partition_root: false,
  tables: [],
  schemas: [],
};

const cloneTables = (tables: PublicationProps["tables"]) =>
  tables.map((table) => ({
    ...table,
    columns: table.columns ? [...table.columns] : null,
  }));

const makePublication = (override: Partial<PublicationProps> = {}) =>
  new Publication({
    ...base,
    ...override,
    tables: override.tables
      ? cloneTables(override.tables)
      : cloneTables(base.tables),
    schemas: override.schemas ? [...override.schemas] : [...base.schemas],
  });

describe("publication.drop", () => {
  test("serialize drop statement and track dependencies", () => {
    const publication = makePublication();
    const change = new DropPublication({ publication });

    expect(change.drops).toEqual([publication.stableId]);
    expect(change.requires).toEqual([publication.stableId]);
    expect(change.serialize()).toBe("DROP PUBLICATION pub_drop_me");
  });
});
