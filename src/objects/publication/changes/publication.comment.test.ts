import { describe, expect, test } from "vitest";
import { stableId } from "../../utils.ts";
import { Publication } from "../publication.model.ts";
import {
  CreateCommentOnPublication,
  DropCommentOnPublication,
} from "./publication.comment.ts";

type PublicationProps = ConstructorParameters<typeof Publication>[0];

const base: PublicationProps = {
  name: "pub_comment",
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

describe("publication.comment", () => {
  test("create comment serializes and tracks dependencies", () => {
    const publication = makePublication({
      comment: "publication's overview",
    });
    const change = new CreateCommentOnPublication({ publication });

    expect(change.creates).toEqual([stableId.comment(publication.stableId)]);
    expect(change.requires).toEqual([publication.stableId]);
    expect(change.serialize()).toBe(
      "COMMENT ON PUBLICATION pub_comment IS 'publication''s overview'",
    );
  });

  test("drop comment serializes and tracks dependencies", () => {
    const publication = makePublication({
      comment: "some comment",
    });
    const change = new DropCommentOnPublication({ publication });

    expect(change.drops).toEqual([stableId.comment(publication.stableId)]);
    expect(change.requires).toEqual([
      stableId.comment(publication.stableId),
      publication.stableId,
    ]);
    expect(change.serialize()).toBe(
      "COMMENT ON PUBLICATION pub_comment IS NULL",
    );
  });
});
