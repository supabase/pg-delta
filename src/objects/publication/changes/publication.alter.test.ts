import { describe, expect, test } from "vitest";
import { stableId } from "../../utils.ts";
import type { PublicationTableProps } from "../publication.model.ts";
import { Publication } from "../publication.model.ts";
import {
  AlterPublicationAddSchemas,
  AlterPublicationAddTables,
  AlterPublicationDropSchemas,
  AlterPublicationDropTables,
  AlterPublicationSetForAllTables,
  AlterPublicationSetList,
  AlterPublicationSetOptions,
  AlterPublicationSetOwner,
} from "./publication.alter.ts";

type PublicationProps = ConstructorParameters<typeof Publication>[0];

const base: PublicationProps = {
  name: "pub_base",
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

describe("publication.alter", () => {
  test("set options serializes assignments and requires publication", () => {
    const publication = makePublication({
      name: "pub_options",
      publish_delete: false,
      publish_truncate: false,
      publish_via_partition_root: true,
    });
    const change = new AlterPublicationSetOptions({
      publication,
      setPublish: true,
      setPublishViaPartitionRoot: true,
    });

    expect(change.requires).toEqual([publication.stableId]);
    expect(change.serialize()).toBe(
      "ALTER PUBLICATION pub_options SET (publish = 'insert, update', publish_via_partition_root = true)",
    );
  });

  test("set for all tables serializes and requires publication", () => {
    const publication = makePublication({
      name: "pub_all",
      all_tables: false,
    });
    const change = new AlterPublicationSetForAllTables({ publication });

    expect(change.requires).toEqual([publication.stableId]);
    expect(change.serialize()).toBe(
      "ALTER PUBLICATION pub_all SET FOR ALL TABLES",
    );
  });

  test("set list serializes object selection and tracks dependencies", () => {
    const publication = makePublication({
      name: "pub_set_list",
      all_tables: false,
      tables: [
        {
          schema: "public",
          name: "authors",
          columns: ["name", "id"],
          row_filter: null,
        },
        {
          schema: "public",
          name: "articles",
          columns: null,
          row_filter: " published = true ",
        },
      ],
      schemas: ["analytics"],
    });
    const change = new AlterPublicationSetList({ publication });

    expect(change.requires).toEqual([
      publication.stableId,
      stableId.table("public", "articles"),
      stableId.table("public", "authors"),
      stableId.column("public", "authors", "id"),
      stableId.column("public", "authors", "name"),
      stableId.schema("analytics"),
    ]);
    expect(change.serialize()).toBe(
      "ALTER PUBLICATION pub_set_list SET TABLE public.articles WHERE (published = true), TABLE public.authors (id, name), TABLES IN SCHEMA analytics",
    );
  });

  test("add tables serializes new tables and tracks dependencies", () => {
    const publication = makePublication({ name: "pub_add_tables" });
    const tables: PublicationTableProps[] = [
      {
        schema: "public",
        name: "logs",
        columns: null,
        row_filter: null,
      },
      {
        schema: "audit",
        name: "events",
        columns: ["created_at", "id"],
        row_filter: null,
      },
    ];
    const change = new AlterPublicationAddTables({ publication, tables });

    expect(change.requires).toEqual([
      publication.stableId,
      stableId.table("public", "logs"),
      stableId.table("audit", "events"),
      stableId.column("audit", "events", "created_at"),
      stableId.column("audit", "events", "id"),
    ]);
    expect(change.serialize()).toBe(
      "ALTER PUBLICATION pub_add_tables ADD TABLE public.logs, TABLE audit.events (created_at, id)",
    );
  });

  test("drop tables serializes target list and tracks dependencies", () => {
    const publication = makePublication({ name: "pub_drop_tables" });
    const tables: PublicationTableProps[] = [
      {
        schema: "public",
        name: "logs",
        columns: null,
        row_filter: null,
      },
      {
        schema: "audit",
        name: "events",
        columns: ["id"],
        row_filter: null,
      },
    ];
    const change = new AlterPublicationDropTables({ publication, tables });

    expect(change.requires).toEqual([
      publication.stableId,
      stableId.table("public", "logs"),
      stableId.table("audit", "events"),
    ]);
    expect(change.serialize()).toBe(
      "ALTER PUBLICATION pub_drop_tables DROP TABLE public.logs, audit.events",
    );
  });

  test("add schemas serializes and tracks dependencies", () => {
    const publication = makePublication({ name: "pub_add_schemas" });
    const change = new AlterPublicationAddSchemas({
      publication,
      schemas: ["analytics", "sales"],
    });

    expect(change.requires).toEqual([
      publication.stableId,
      stableId.schema("analytics"),
      stableId.schema("sales"),
    ]);
    expect(change.serialize()).toBe(
      "ALTER PUBLICATION pub_add_schemas ADD TABLES IN SCHEMA analytics, TABLES IN SCHEMA sales",
    );
  });

  test("drop schemas serializes and tracks dependencies", () => {
    const publication = makePublication({ name: "pub_drop_schemas" });
    const change = new AlterPublicationDropSchemas({
      publication,
      schemas: ["analytics", "sales"],
    });

    expect(change.requires).toEqual([
      publication.stableId,
      stableId.schema("analytics"),
      stableId.schema("sales"),
    ]);
    expect(change.serialize()).toBe(
      "ALTER PUBLICATION pub_drop_schemas DROP TABLES IN SCHEMA analytics, TABLES IN SCHEMA sales",
    );
  });

  test("set owner serializes and tracks dependencies", () => {
    const publication = makePublication({ name: "pub_owner" });
    const change = new AlterPublicationSetOwner({
      publication,
      owner: "owner2",
    });

    expect(change.requires).toEqual([
      publication.stableId,
      stableId.role("owner2"),
    ]);
    expect(change.serialize()).toBe(
      "ALTER PUBLICATION pub_owner OWNER TO owner2",
    );
  });
});
