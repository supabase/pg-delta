import { describe, expect, test } from "bun:test";
import { Catalog, createEmptyCatalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import type { PgDepend } from "../depend.ts";
import { AlterPublicationDropTables } from "../objects/publication/changes/publication.alter.ts";
import { Publication } from "../objects/publication/publication.model.ts";
import { DropSequence } from "../objects/sequence/changes/sequence.drop.ts";
import { Sequence } from "../objects/sequence/sequence.model.ts";
import {
  AlterTableAlterColumnType,
  AlterTableDropConstraint,
} from "../objects/table/changes/table.alter.ts";
import { DropTable } from "../objects/table/changes/table.drop.ts";
import { Table } from "../objects/table/table.model.ts";
import { CreateView } from "../objects/view/changes/view.create.ts";
import { DropView } from "../objects/view/changes/view.drop.ts";
import { View } from "../objects/view/view.model.ts";
import { sortChanges } from "./sort-changes.ts";

const baseTableProps = {
  schema: "public",
  persistence: "p" as const,
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d" as const,
  is_partition: false,
  options: null,
  partition_bound: null,
  partition_by: null,
  owner: "postgres",
  comment: null,
  parent_schema: null,
  parent_name: null,
  privileges: [],
};

function integerColumn(name: string, position: number) {
  return {
    name,
    position,
    data_type: "integer",
    data_type_str: "integer",
    is_custom_type: false,
    custom_type_type: null,
    custom_type_category: null,
    custom_type_schema: null,
    custom_type_name: null,
    not_null: false,
    is_identity: false,
    is_identity_always: false,
    is_generated: false,
    collation: null,
    default: null,
    comment: null,
  };
}

function fkConstraint(props: {
  name: string;
  fkColumn: string;
  targetTable: string;
  targetColumn?: string;
}) {
  const targetColumn = props.targetColumn ?? "id";
  return {
    name: props.name,
    constraint_type: "f" as const,
    deferrable: false,
    initially_deferred: false,
    validated: true,
    is_local: true,
    no_inherit: false,
    is_temporal: false,
    is_partition_clone: false,
    parent_constraint_schema: null,
    parent_constraint_name: null,
    parent_table_schema: null,
    parent_table_name: null,
    key_columns: [props.fkColumn],
    foreign_key_columns: [targetColumn],
    foreign_key_table: props.targetTable,
    foreign_key_schema: "public",
    foreign_key_table_is_partition: false,
    foreign_key_parent_schema: null,
    foreign_key_parent_table: null,
    foreign_key_effective_schema: "public",
    foreign_key_effective_table: props.targetTable,
    on_update: "a" as const,
    on_delete: "a" as const,
    match_type: "s" as const,
    check_expression: null,
    owner: "postgres",
    definition: `FOREIGN KEY (${props.fkColumn}) REFERENCES public.${props.targetTable}(${targetColumn})`,
    comment: null,
  };
}

function uniqueConstraint(name: string, column: string) {
  return {
    name,
    constraint_type: "u" as const,
    deferrable: false,
    initially_deferred: false,
    validated: true,
    is_local: true,
    no_inherit: false,
    is_temporal: false,
    is_partition_clone: false,
    parent_constraint_schema: null,
    parent_constraint_name: null,
    parent_table_schema: null,
    parent_table_name: null,
    key_columns: [column],
    foreign_key_columns: null,
    foreign_key_table: null,
    foreign_key_schema: null,
    foreign_key_table_is_partition: null,
    foreign_key_parent_schema: null,
    foreign_key_parent_table: null,
    foreign_key_effective_schema: null,
    foreign_key_effective_table: null,
    on_update: null,
    on_delete: null,
    match_type: null,
    check_expression: null,
    owner: "postgres",
    definition: `UNIQUE (${column})`,
    comment: null,
  };
}

function table(
  name: string,
  constraints: ConstructorParameters<typeof Table>[0]["constraints"] = [],
) {
  return new Table({
    ...baseTableProps,
    name,
    columns: [
      { ...integerColumn("id", 1), not_null: true },
      integerColumn("post_id", 2),
      integerColumn("lab_id", 3),
    ],
    constraints,
  });
}

function view(name: string, columns = [integerColumn("id", 1)]) {
  return new View({
    schema: "public",
    name,
    definition: "SELECT id FROM users",
    row_security: false,
    force_row_security: false,
    has_indexes: false,
    has_rules: true,
    has_triggers: false,
    has_subclasses: false,
    is_populated: true,
    replica_identity: "d",
    is_partition: false,
    options: null,
    partition_bound: null,
    owner: "postgres",
    comment: null,
    columns,
    privileges: [],
  });
}

async function catalogWithDepends(depends: PgDepend[]) {
  const base = await createEmptyCatalog(170000, "postgres");
  // oxlint-disable-next-line typescript/no-misused-spread
  return new Catalog({ ...base, depends });
}

function changeLabel(change: Change) {
  if (change instanceof AlterTableDropConstraint) {
    return `${change.constructor.name}:${change.table.name}.${change.constraint.name}`;
  }
  if (change instanceof DropTable) {
    return `${change.constructor.name}:${change.table.name}`;
  }
  return change.constructor.name;
}

describe("sortChanges", () => {
  test("orders dependent view drop before drop-phase column type rewrite", async () => {
    const branchTable = table("users");
    const mainColumn = {
      ...integerColumn("age", 4),
      data_type: "numeric",
      data_type_str: "numeric",
    };
    const branchColumn = integerColumn("age", 4);
    const dependentView = view("user_ages", [
      integerColumn("id", 1),
      mainColumn,
    ]);
    const recreatedView = view("user_ages", [
      integerColumn("id", 1),
      branchColumn,
    ]);
    const changes: Change[] = [
      new AlterTableAlterColumnType({
        table: branchTable,
        column: branchColumn,
        previousColumn: mainColumn,
      }),
      new DropView({ view: dependentView }),
      new CreateView({ view: recreatedView }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: dependentView.stableId,
        referenced_stable_id: "column:public.users.age",
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      "DropView",
      "AlterTableAlterColumnType",
      "CreateView",
    ]);
  });

  test("breaks the cycle between dropping an owned sequence and rewriting its column", async () => {
    const branchTable = table("items");
    const mainColumn = {
      ...integerColumn("id", 1),
      not_null: true,
      data_type: "bigint",
      data_type_str: "bigint",
    };
    const branchColumn = {
      ...mainColumn,
      data_type: "numeric",
      data_type_str: "numeric",
    };
    const sequence = new Sequence({
      schema: "public",
      name: "items_id_seq",
      data_type: "bigint",
      start_value: 1,
      minimum_value: 1n,
      maximum_value: 9223372036854775807n,
      increment: 1,
      cycle_option: false,
      cache_size: 1,
      persistence: "p",
      owned_by_schema: "public",
      owned_by_table: "items",
      owned_by_column: "id",
      comment: null,
      privileges: [],
      owner: "postgres",
    });
    const changes: Change[] = [
      new DropSequence({ sequence }),
      new AlterTableAlterColumnType({
        table: branchTable,
        column: branchColumn,
        previousColumn: mainColumn,
      }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "column:public.items.id",
        referenced_stable_id: "sequence:public.items_id_seq",
        deptype: "n",
      },
      {
        dependent_stable_id: "sequence:public.items_id_seq",
        referenced_stable_id: "column:public.items.id",
        deptype: "a",
      },
    ]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      "AlterTableAlterColumnType",
      "DropSequence",
    ]);
  });

  test("breaks publication FK-chain constraint-drop cycle with one dropped table", async () => {
    const labs = table("labs", [uniqueConstraint("unique_lab_id", "id")]);
    const posts = table("posts", [
      fkConstraint({
        name: "posts_lab_id_fkey",
        fkColumn: "lab_id",
        targetTable: "labs",
      }),
    ]);
    const publication = new Publication({
      name: "supabase_realtime",
      owner: "postgres",
      comment: null,
      all_tables: false,
      publish_insert: true,
      publish_update: true,
      publish_delete: true,
      publish_truncate: true,
      publish_via_partition_root: false,
      tables: [
        {
          schema: "public",
          name: "labs",
          columns: null,
          row_filter: null,
        },
        {
          schema: "public",
          name: "posts",
          columns: null,
          row_filter: null,
        },
      ],
      schemas: [],
    });
    const changes: Change[] = [
      new AlterPublicationDropTables({
        publication,
        tables: publication.tables,
      }),
      new DropTable({ table: posts }),
      new AlterTableDropConstraint({
        table: labs,
        constraint: labs.constraints[0],
      }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "publication:supabase_realtime",
        referenced_stable_id: "table:public.posts",
        deptype: "n",
      },
      {
        dependent_stable_id: "constraint:public.posts.posts_lab_id_fkey",
        referenced_stable_id: "constraint:public.labs.unique_lab_id",
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toContain(
      "AlterTableDropConstraint:posts.posts_lab_id_fkey",
    );
  });

  test("breaks publication FK-chain constraint-drop cycle in the drop phase", async () => {
    const labs = table("labs", [uniqueConstraint("unique_lab_id", "id")]);
    const posts = table("posts", [
      fkConstraint({
        name: "posts_lab_id_fkey",
        fkColumn: "lab_id",
        targetTable: "labs",
      }),
    ]);
    const postAttachments = table("post_attachments", [
      fkConstraint({
        name: "post_attachments_post_id_fkey",
        fkColumn: "post_id",
        targetTable: "posts",
      }),
    ]);
    const publication = new Publication({
      name: "supabase_realtime",
      owner: "postgres",
      comment: null,
      all_tables: false,
      publish_insert: true,
      publish_update: true,
      publish_delete: true,
      publish_truncate: true,
      publish_via_partition_root: false,
      tables: [
        {
          schema: "public",
          name: "labs",
          columns: null,
          row_filter: null,
        },
        {
          schema: "public",
          name: "post_attachments",
          columns: null,
          row_filter: null,
        },
        {
          schema: "public",
          name: "posts",
          columns: null,
          row_filter: null,
        },
      ],
      schemas: [],
    });
    const changes: Change[] = [
      new AlterPublicationDropTables({
        publication,
        tables: publication.tables,
      }),
      new DropTable({ table: postAttachments }),
      new DropTable({ table: posts }),
      new AlterTableDropConstraint({
        table: labs,
        constraint: labs.constraints[0],
      }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "publication:supabase_realtime",
        referenced_stable_id: "table:public.post_attachments",
        deptype: "n",
      },
      {
        dependent_stable_id:
          "constraint:public.post_attachments.post_attachments_post_id_fkey",
        referenced_stable_id: "column:public.posts.id",
        deptype: "n",
      },
      {
        dependent_stable_id: "constraint:public.posts.posts_lab_id_fkey",
        referenced_stable_id: "constraint:public.labs.unique_lab_id",
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toContain(
      "AlterTableDropConstraint:post_attachments.post_attachments_post_id_fkey",
    );
    expect(sorted.map(changeLabel)).toContain(
      "AlterTableDropConstraint:posts.posts_lab_id_fkey",
    );
  });
});
