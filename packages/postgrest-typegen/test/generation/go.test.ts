import { describe, expect, test } from "bun:test";

import { generateGo as rawGenerateGo } from "../../src/generation/go.ts";
import { sortGeneratorMetadata } from "../../src/sort.ts";
import {
  addressCompositeType,
  baseColumn,
  baseMaterializedView,
  baseTable,
  baseView,
  buildMetadata,
  textType,
  userStatusEnum,
} from "./fixtures.ts";

// Generators expect pre-sorted metadata (the caller applies the canonical sort
// pass); mirror that here so fixture construction order doesn't matter.
const generateGo = (metadata: Parameters<typeof rawGenerateGo>[0]) =>
  rawGenerateGo(sortGeneratorMetadata(metadata));

describe("go typegen", () => {
  test("table with nullability, identity, generated and default columns", () => {
    const result = generateGo(
      buildMetadata({
        tables: [baseTable()],
        columns: [
          baseColumn({
            name: "id",
            format: "int8",
            is_identity: true,
            ordinal_position: 1,
          }),
          baseColumn({
            name: "status",
            format: "user_status",
            is_nullable: true,
            ordinal_position: 2,
          }),
          baseColumn({ name: "label", format: "text", ordinal_position: 3 }),
          baseColumn({
            name: "computed",
            format: "text",
            is_generated: true,
            ordinal_position: 4,
          }),
          baseColumn({
            name: "with_default",
            format: "int4",
            default_value: "0",
            ordinal_position: 5,
          }),
        ],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "package database

      type PublicTicketsSelect struct {
        Computed    string  \`json:"computed"\`
        Id          int64   \`json:"id"\`
        Label       string  \`json:"label"\`
        Status      *string \`json:"status"\`
        WithDefault int32   \`json:"with_default"\`
      }

      type PublicTicketsInsert struct {
        Computed    *string \`json:"computed"\`
        Id          *int64  \`json:"id"\`
        Label       string  \`json:"label"\`
        Status      *string \`json:"status"\`
        WithDefault *int32  \`json:"with_default"\`
      }

      type PublicTicketsUpdate struct {
        Computed    *string \`json:"computed"\`
        Id          *int64  \`json:"id"\`
        Label       *string \`json:"label"\`
        Status      *string \`json:"status"\`
        WithDefault *int32  \`json:"with_default"\`
      }"
    `);
  });

  test("views, materialized views and foreign tables", () => {
    const result = generateGo(
      buildMetadata({
        tables: [baseTable({ id: 1, name: "tickets" })],
        views: [baseView({ id: 2, name: "tickets_view" })],
        materializedViews: [
          baseMaterializedView({ id: 3, name: "tickets_mv" }),
        ],
        foreignTables: [
          { id: 4, schema: "public", name: "tickets_ft", comment: null },
        ],
        columns: [
          baseColumn({ table_id: 1, name: "a", format: "text" }),
          baseColumn({
            table_id: 2,
            name: "b",
            format: "int4",
            is_nullable: true,
          }),
          baseColumn({ table_id: 3, name: "c", format: "bool" }),
        ],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "package database

      type PublicTicketsSelect struct {
        A string \`json:"a"\`
      }

      type PublicTicketsInsert struct {
        A string \`json:"a"\`
      }

      type PublicTicketsUpdate struct {
        A *string \`json:"a"\`
      }

      type PublicTicketsViewSelect struct {
        B *int32 \`json:"b"\`
      }

      type PublicTicketsMvSelect struct {
        C bool \`json:"c"\`
      }"
    `);
  });

  test("composite type struct", () => {
    const result = generateGo(
      buildMetadata({
        types: [userStatusEnum, textType, addressCompositeType],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "package database







      type PublicAddress struct {
        Street string \`json:"street"\`
        City   string \`json:"city"\`
      }"
    `);
  });
});

describe("go typegen pgTypeToGoType array fallback", () => {
  test("non-nullable array of enum resolves to []string, not []interface{}", () => {
    const result = generateGo(
      buildMetadata({
        tables: [baseTable()],
        columns: [
          baseColumn({
            name: "tags",
            format: "_user_status",
            is_nullable: false,
          }),
        ],
      }),
    );

    expect(result).toMatch(/Tags\s+\[]string\b/);
    expect(result).not.toMatch(/Tags\s+\[]interface\{\}/);
  });

  test("nullable array of enum resolves to []*string, not []interface{}", () => {
    const result = generateGo(
      buildMetadata({
        tables: [baseTable()],
        columns: [
          baseColumn({
            name: "tags",
            format: "_user_status",
            is_nullable: true,
          }),
        ],
      }),
    );

    expect(result).toMatch(/Tags\s+\[]\*string\b/);
    expect(result).not.toMatch(/Tags\s+\[]interface\{\}/);
  });

  test("plain text array still resolves to []string", () => {
    const result = generateGo(
      buildMetadata({
        tables: [baseTable()],
        columns: [
          baseColumn({ name: "tags", format: "_text", is_nullable: false }),
        ],
      }),
    );

    expect(result).toMatch(/Tags\s+\[]string\b/);
  });
});
