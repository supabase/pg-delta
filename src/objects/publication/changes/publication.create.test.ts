import { describe, expect, test } from "vitest";
import { stableId } from "../../utils.ts";
import { Publication } from "../publication.model.ts";
import { CreatePublication } from "./publication.create.ts";

type PublicationProps = ConstructorParameters<typeof Publication>[0];

const base: PublicationProps = {
  name: "pub_all_tables",
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

describe("publication.create", () => {
  test("serialize publication for all tables", () => {
    const publication = makePublication();
    const change = new CreatePublication({ publication });

    expect(change.creates).toEqual([publication.stableId]);
    expect(change.requires).toEqual([stableId.role(publication.owner)]);
    expect(change.serialize()).toBe(
      "CREATE PUBLICATION pub_all_tables FOR ALL TABLES",
    );
  });

  test("serialize publication with explicit objects and options", () => {
    const publication = makePublication({
      name: "pub_custom",
      all_tables: false,
      publish_delete: false,
      publish_truncate: false,
      publish_via_partition_root: true,
      tables: [
        {
          schema: "public",
          name: "articles",
          columns: null,
          row_filter: "id > 1",
        },
        {
          schema: "public",
          name: "authors",
          columns: ["name", "id"],
          row_filter: null,
        },
      ],
      schemas: ["analytics"],
    });
    const change = new CreatePublication({ publication });

    expect(change.requires).toEqual([
      stableId.role(publication.owner),
      stableId.table("public", "articles"),
      stableId.table("public", "authors"),
      stableId.column("public", "authors", "id"),
      stableId.column("public", "authors", "name"),
      stableId.schema("analytics"),
    ]);
    expect(change.serialize()).toBe(
      "CREATE PUBLICATION pub_custom FOR TABLE public.articles WHERE (id > 1), TABLE public.authors (id, name), TABLES IN SCHEMA analytics WITH (publish = 'insert, update', publish_via_partition_root = true)",
    );
  });
});
