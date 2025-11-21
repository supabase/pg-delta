import { describe, expect, test } from "vitest";
import {
  AlterPublicationAddSchemas,
  AlterPublicationAddTables,
  AlterPublicationDropSchemas,
  AlterPublicationDropTables,
  AlterPublicationSetForAllTables,
  AlterPublicationSetOptions,
  AlterPublicationSetOwner,
} from "./changes/publication.alter.ts";
import {
  CreateCommentOnPublication,
  DropCommentOnPublication,
} from "./changes/publication.comment.ts";
import { CreatePublication } from "./changes/publication.create.ts";
import { DropPublication } from "./changes/publication.drop.ts";
import { diffPublications } from "./publication.diff.ts";
import { Publication, type PublicationProps } from "./publication.model.ts";

const base: PublicationProps = {
  name: "mypub",
  owner: "postgres",
  comment: null,
  all_tables: false,
  publish_insert: true,
  publish_update: true,
  publish_delete: true,
  publish_truncate: true,
  publish_via_partition_root: false,
  tables: [],
  schemas: [],
};

describe.concurrent("publication.diff", () => {
  test("create and drop publication", () => {
    const publication = new Publication(base);
    const created = diffPublications(
      { currentUser: "postgres" },
      {},
      { [publication.stableId]: publication },
    );
    expect(created.some((change) => change instanceof CreatePublication)).toBe(
      true,
    );

    const dropped = diffPublications(
      { currentUser: "postgres" },
      { [publication.stableId]: publication },
      {},
    );
    expect(dropped.some((change) => change instanceof DropPublication)).toBe(
      true,
    );
  });

  test("create publication requires referenced objects", () => {
    const publication = new Publication({
      ...base,
      tables: [
        {
          schema: "public",
          name: "accounts",
          columns: ["id", "amount"],
          row_filter: null,
        },
      ],
      schemas: ["analytics"],
    });

    const changes = diffPublications(
      { currentUser: "postgres" },
      {},
      { [publication.stableId]: publication },
    );

    const createChange = changes.find(
      (change) => change instanceof CreatePublication,
    );
    expect(createChange).toBeDefined();
    expect(createChange?.requires).toEqual(
      expect.arrayContaining([
        "role:postgres",
        "table:public.accounts",
        "column:public.accounts.id",
        "column:public.accounts.amount",
        "schema:analytics",
      ]),
    );
  });

  test("detect publish option changes", () => {
    const mainPublication = new Publication(base);
    const branchPublication = new Publication({
      ...base,
      publish_delete: false,
    });
    const changes = diffPublications(
      { currentUser: "postgres" },
      { [mainPublication.stableId]: mainPublication },
      { [branchPublication.stableId]: branchPublication },
    );
    expect(
      changes.some((change) => change instanceof AlterPublicationSetOptions),
    ).toBe(true);
  });

  test("switch to FOR ALL TABLES", () => {
    const mainPublication = new Publication(base);
    const branchPublication = new Publication({
      ...base,
      all_tables: true,
    });
    const changes = diffPublications(
      { currentUser: "postgres" },
      { [mainPublication.stableId]: mainPublication },
      { [branchPublication.stableId]: branchPublication },
    );
    expect(
      changes.some(
        (change) => change instanceof AlterPublicationSetForAllTables,
      ),
    ).toBe(true);
  });

  test("switch from FOR ALL TABLES to explicit list", () => {
    const mainPublication = new Publication({
      ...base,
      all_tables: true,
    });
    const branchPublication = new Publication({
      ...base,
      tables: [
        {
          schema: "public",
          name: "mytable",
          columns: null,
          row_filter: null,
        },
      ],
    });
    const changes = diffPublications(
      { currentUser: "postgres" },
      { [mainPublication.stableId]: mainPublication },
      { [branchPublication.stableId]: branchPublication },
    );
    expect(changes.some((change) => change instanceof DropPublication)).toBe(
      true,
    );
    expect(changes.some((change) => change instanceof CreatePublication)).toBe(
      true,
    );
  });

  test("add and drop tables", () => {
    const mainPublication = new Publication(base);
    const branchPublication = new Publication({
      ...base,
      tables: [
        {
          schema: "public",
          name: "t",
          columns: ["id"],
          row_filter: null,
        },
      ],
    });
    const addChanges = diffPublications(
      { currentUser: "postgres" },
      { [mainPublication.stableId]: mainPublication },
      { [branchPublication.stableId]: branchPublication },
    );
    expect(
      addChanges.some((change) => change instanceof AlterPublicationAddTables),
    ).toBe(true);

    const addTablesChange = addChanges.find(
      (change) => change instanceof AlterPublicationAddTables,
    );
    expect(addTablesChange?.requires).toEqual(
      expect.arrayContaining(["table:public.t", "column:public.t.id"]),
    );

    const dropChanges = diffPublications(
      { currentUser: "postgres" },
      { [branchPublication.stableId]: branchPublication },
      { [mainPublication.stableId]: mainPublication },
    );
    expect(
      dropChanges.some(
        (change) => change instanceof AlterPublicationDropTables,
      ),
    ).toBe(true);
  });

  test("detect row filter change as drop and add", () => {
    const mainPublication = new Publication({
      ...base,
      tables: [
        {
          schema: "public",
          name: "t",
          columns: null,
          row_filter: null,
        },
      ],
    });
    const branchPublication = new Publication({
      ...base,
      tables: [
        {
          schema: "public",
          name: "t",
          columns: null,
          row_filter: "(id > 0)",
        },
      ],
    });
    const changes = diffPublications(
      { currentUser: "postgres" },
      { [mainPublication.stableId]: mainPublication },
      { [branchPublication.stableId]: branchPublication },
    );
    expect(
      changes.some((change) => change instanceof AlterPublicationDropTables),
    ).toBe(true);
    expect(
      changes.some((change) => change instanceof AlterPublicationAddTables),
    ).toBe(true);
  });

  test("add and drop schemas", () => {
    const mainPublication = new Publication(base);
    const branchPublication = new Publication({
      ...base,
      schemas: ["public"],
    });
    const addChanges = diffPublications(
      { currentUser: "postgres" },
      { [mainPublication.stableId]: mainPublication },
      { [branchPublication.stableId]: branchPublication },
    );
    expect(
      addChanges.some((change) => change instanceof AlterPublicationAddSchemas),
    ).toBe(true);

    const dropChanges = diffPublications(
      { currentUser: "postgres" },
      { [branchPublication.stableId]: branchPublication },
      { [mainPublication.stableId]: mainPublication },
    );
    expect(
      dropChanges.some(
        (change) => change instanceof AlterPublicationDropSchemas,
      ),
    ).toBe(true);
  });

  test("owner and comment changes", () => {
    const mainPublication = new Publication(base);
    const branchPublication = new Publication({
      ...base,
      owner: "other_user",
      comment: "replication publication",
    });
    const changes = diffPublications(
      { currentUser: "postgres" },
      { [mainPublication.stableId]: mainPublication },
      { [branchPublication.stableId]: branchPublication },
    );
    expect(
      changes.some((change) => change instanceof AlterPublicationSetOwner),
    ).toBe(true);
    expect(
      changes.some((change) => change instanceof CreateCommentOnPublication),
    ).toBe(true);

    const removeCommentPublication = new Publication({
      ...base,
      comment: null,
    });
    const dropCommentChanges = diffPublications(
      { currentUser: "postgres" },
      { [branchPublication.stableId]: branchPublication },
      { [removeCommentPublication.stableId]: removeCommentPublication },
    );
    expect(
      dropCommentChanges.some(
        (change) => change instanceof DropCommentOnPublication,
      ),
    ).toBe(true);
  });
});
