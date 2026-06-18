import { describe, expect, test } from "bun:test";

import type { PostgresRelationship } from "../../src/types.ts";
import {
  expandViewRelationships,
  listRelationships,
  type ViewKeyDependency,
} from "../../src/introspection/relationships.ts";

const postsAuthorFk: PostgresRelationship = {
  foreign_key_name: "posts_author_id_fkey",
  schema: "public",
  relation: "posts",
  columns: ["author_id"],
  is_one_to_one: false,
  referenced_schema: "public",
  referenced_relation: "users",
  referenced_columns: ["id"],
};

const viewToTableDep: ViewKeyDependency = {
  table_schema: "public",
  table_name: "posts",
  view_schema: "public",
  view_name: "posts_view",
  constraint_name: "posts_author_id_fkey",
  constraint_type: "f",
  column_dependencies: [
    { table_column: "author_id", view_columns: ["author_id"] },
  ],
};

const tableToViewDep: ViewKeyDependency = {
  table_schema: "public",
  table_name: "users",
  view_schema: "public",
  view_name: "users_view",
  constraint_name: "posts_author_id_fkey",
  constraint_type: "f_ref",
  column_dependencies: [{ table_column: "id", view_columns: ["id"] }],
};

describe("expandViewRelationships", () => {
  test("view→table expansion (constraint_type 'f')", () => {
    const result = expandViewRelationships([postsAuthorFk], [viewToTableDep]);

    expect(result).toEqual([
      {
        foreign_key_name: "posts_author_id_fkey",
        schema: "public",
        relation: "posts_view",
        columns: ["author_id"],
        is_one_to_one: false,
        referenced_schema: "public",
        referenced_relation: "users",
        referenced_columns: ["id"],
      },
    ]);
  });

  test("table→view expansion (constraint_type 'f_ref')", () => {
    const result = expandViewRelationships([postsAuthorFk], [tableToViewDep]);

    expect(result).toEqual([
      {
        foreign_key_name: "posts_author_id_fkey",
        schema: "public",
        relation: "posts",
        columns: ["author_id"],
        is_one_to_one: false,
        referenced_schema: "public",
        referenced_relation: "users_view",
        referenced_columns: ["id"],
      },
    ]);
  });

  test("view→view expansion combines both dependency kinds", () => {
    const result = expandViewRelationships(
      [postsAuthorFk],
      [viewToTableDep, tableToViewDep],
    );

    // view→table, table→view, then view→view
    expect(result).toEqual([
      {
        foreign_key_name: "posts_author_id_fkey",
        schema: "public",
        relation: "posts_view",
        columns: ["author_id"],
        is_one_to_one: false,
        referenced_schema: "public",
        referenced_relation: "users",
        referenced_columns: ["id"],
      },
      {
        foreign_key_name: "posts_author_id_fkey",
        schema: "public",
        relation: "posts",
        columns: ["author_id"],
        is_one_to_one: false,
        referenced_schema: "public",
        referenced_relation: "users_view",
        referenced_columns: ["id"],
      },
      {
        foreign_key_name: "posts_author_id_fkey",
        schema: "public",
        relation: "posts_view",
        columns: ["author_id"],
        is_one_to_one: false,
        referenced_schema: "public",
        referenced_relation: "users_view",
        referenced_columns: ["id"],
      },
    ]);
  });

  test("cartesian product over multiple view columns and composite keys", () => {
    const compositeFk: PostgresRelationship = {
      foreign_key_name: "memberships_org_fkey",
      schema: "public",
      relation: "memberships",
      columns: ["org_id", "user_id"],
      is_one_to_one: true,
      referenced_schema: "public",
      referenced_relation: "orgs",
      referenced_columns: ["org_id", "owner_id"],
    };
    const compositeDep: ViewKeyDependency = {
      table_schema: "public",
      table_name: "memberships",
      view_schema: "public",
      view_name: "memberships_view",
      constraint_name: "memberships_org_fkey",
      constraint_type: "f",
      column_dependencies: [
        { table_column: "org_id", view_columns: ["org_id", "organization_id"] },
        { table_column: "user_id", view_columns: ["user_id", "member_id"] },
      ],
    };

    const result = expandViewRelationships([compositeFk], [compositeDep]);

    // 2 x 2 cartesian product of the view column permutations
    expect(result.map((r) => r.columns)).toEqual([
      ["org_id", "user_id"],
      ["org_id", "member_id"],
      ["organization_id", "user_id"],
      ["organization_id", "member_id"],
    ]);
    expect(
      result.every(
        (r) => r.relation === "memberships_view" && r.is_one_to_one === true,
      ),
    ).toBe(true);
  });

  test("returns nothing when no view depends on the relationship", () => {
    expect(expandViewRelationships([postsAuthorFk], [])).toEqual([]);
  });
});

describe("listRelationships", () => {
  test("concatenates table relationships with view-derived ones", async () => {
    const db = {
      query: async (sql: string) => ({
        rows: sql.includes("pks_uniques_cols")
          ? [postsAuthorFk]
          : [viewToTableDep],
      }),
    };

    const result = await listRelationships(db, { includedSchemas: ["public"] });

    expect(result).toEqual([
      postsAuthorFk,
      {
        foreign_key_name: "posts_author_id_fkey",
        schema: "public",
        relation: "posts_view",
        columns: ["author_id"],
        is_one_to_one: false,
        referenced_schema: "public",
        referenced_relation: "users",
        referenced_columns: ["id"],
      },
    ]);
  });
});
