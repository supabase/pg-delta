import { describe, expect, test } from "bun:test";

import { generateTypescript } from "../generation/index.ts";
import { parseGeneratorMetadata } from "../types.ts";
import {
  metadataToGeneratorMetadata,
  openApiToGeneratorMetadata,
} from "./index.ts";
import type { PostgrestTypegenMetadata } from "./types.ts";

/**
 * A representative metadata block exercising the cases that distinguish the
 * OpenAPI producer from the spike: object kinds, identity/generated columns,
 * enums, composites, a computed scalar field, a relation-returning function,
 * and a one-to-one relationship.
 */
const block: PostgrestTypegenMetadata = {
  schemas: [{ name: "public", owner: "postgres" }],
  enums: [
    { schema: "public", name: "user_status", values: ["ACTIVE", "INACTIVE"] },
  ],
  composites: [
    {
      schema: "public",
      name: "point3d",
      attributes: [
        { name: "x", type: "float8" },
        { name: "y", type: "float8" },
        { name: "z", type: "float8" },
      ],
    },
  ],
  tables: [
    {
      schema: "public",
      name: "users",
      kind: "table",
      updatable: true,
      columns: [
        {
          name: "id",
          format: "int8",
          is_nullable: false,
          is_identity: true,
          identity_generation: "BY DEFAULT",
          is_generated: false,
          is_updatable: true,
        },
        {
          name: "name",
          format: "text",
          is_nullable: true,
          is_identity: false,
          is_generated: false,
          is_updatable: true,
        },
        {
          name: "status",
          format: "user_status",
          is_nullable: true,
          default_value: "'ACTIVE'::user_status",
          is_identity: false,
          is_generated: false,
          is_updatable: true,
          enums: ["ACTIVE", "INACTIVE"],
        },
        {
          name: "home",
          format: "point3d",
          is_nullable: true,
          is_identity: false,
          is_generated: false,
          is_updatable: true,
        },
      ],
    },
    {
      schema: "public",
      name: "todos",
      kind: "table",
      updatable: true,
      columns: [
        {
          name: "id",
          format: "int8",
          is_nullable: false,
          is_identity: true,
          identity_generation: "ALWAYS",
          is_generated: false,
          is_updatable: true,
        },
        {
          name: "user_id",
          format: "int8",
          is_nullable: false,
          is_identity: false,
          is_generated: false,
          is_updatable: true,
        },
        {
          name: "details",
          format: "text",
          is_nullable: true,
          is_identity: false,
          is_generated: false,
          is_updatable: true,
        },
      ],
    },
    {
      schema: "public",
      name: "active_users",
      kind: "view",
      updatable: false,
      columns: [
        {
          name: "id",
          format: "int8",
          is_nullable: true,
          is_identity: false,
          is_generated: false,
          is_updatable: false,
        },
        {
          name: "name",
          format: "text",
          is_nullable: true,
          is_identity: false,
          is_generated: false,
          is_updatable: true,
        },
      ],
    },
  ],
  relationships: [
    {
      constraint_name: "todos_user_id_fkey",
      schema: "public",
      relation: "todos",
      columns: ["user_id"],
      is_one_to_one: false,
      referenced_schema: "public",
      referenced_relation: "users",
      referenced_columns: ["id"],
    },
  ],
  functions: [
    {
      schema: "public",
      name: "add",
      argument_types: "integer, integer",
      args: [
        { name: "a", type: "int4", mode: "in", has_default: false },
        { name: "b", type: "int4", mode: "in", has_default: false },
      ],
      return: { type: "int4", is_set: false },
      volatility: "IMMUTABLE",
    },
    {
      // computed scalar field on `todos` (single table-row arg)
      schema: "public",
      name: "details_length",
      argument_types: "todos",
      args: [{ name: "", type: "todos", mode: "in", has_default: false }],
      return: { type: "int4", is_set: false },
      volatility: "STABLE",
    },
    {
      // relation-returning function -> SetofOptions
      schema: "public",
      name: "list_users",
      argument_types: "",
      args: [],
      return: {
        type: "users",
        is_set: true,
        relation: { schema: "public", name: "users" },
        rows: null,
      },
      volatility: "STABLE",
    },
  ],
};

describe("openApiToGeneratorMetadata", () => {
  test("throws when the metadata extension is absent", () => {
    expect(() => openApiToGeneratorMetadata({ swagger: "2.0" })).toThrow(
      /x-postgrest-typegen-metadata/,
    );
  });

  test("reads the metadata extension from an OpenAPI doc", () => {
    const meta = openApiToGeneratorMetadata({
      "x-postgrest-typegen-metadata": block,
    });
    expect(meta.tables.map((t) => t.name).sort()).toEqual(["todos", "users"]);
    expect(meta.views.map((v) => v.name)).toEqual(["active_users"]);
  });
});

describe("metadataToGeneratorMetadata", () => {
  const meta = metadataToGeneratorMetadata(block);

  test("produces a shape-valid GeneratorMetadata", () => {
    expect(() => parseGeneratorMetadata(meta)).not.toThrow();
  });

  test("splits relations by kind", () => {
    expect(meta.tables.map((t) => t.name).sort()).toEqual(["todos", "users"]);
    expect(meta.views.map((v) => v.name)).toEqual(["active_users"]);
    expect(meta.foreignTables).toEqual([]);
    expect(meta.materializedViews).toEqual([]);
  });

  test("maps identity / nullability / enum onto columns", () => {
    const usersId = meta.columns.find(
      (c) => c.table === "users" && c.name === "id",
    )!;
    expect(usersId.is_identity).toBe(true);
    expect(usersId.identity_generation).toBe("BY DEFAULT");
    expect(usersId.is_nullable).toBe(false);

    const status = meta.columns.find((c) => c.name === "status")!;
    expect(status.enums).toEqual(["ACTIVE", "INACTIVE"]);
    expect(status.default_value).toBe("'ACTIVE'::user_status");
  });

  test("keeps table_id consistent between a table and its columns", () => {
    const todos = meta.tables.find((t) => t.name === "todos")!;
    const todosCols = meta.columns.filter((c) => c.table_id === todos.id);
    expect(todosCols.map((c) => c.name).sort()).toEqual([
      "details",
      "id",
      "user_id",
    ]);
  });

  test("registers enum and composite types (and not table row types) as such", () => {
    const userStatus = meta.types.find((t) => t.name === "user_status")!;
    expect(userStatus.enums).toEqual(["ACTIVE", "INACTIVE"]);
    const point3d = meta.types.find((t) => t.name === "point3d")!;
    expect(point3d.attributes.map((a) => a.name)).toEqual(["x", "y", "z"]);
    // table row type carries a relation id but no attributes (so it is not a composite)
    const usersType = meta.types.find((t) => t.name === "users")!;
    expect(usersType.type_relation_id).not.toBeNull();
    expect(usersType.attributes).toEqual([]);
  });

  test("maps a relation-returning function to return_type_relation_id", () => {
    const listUsers = meta.functions.find((f) => f.name === "list_users")!;
    const usersTable = meta.tables.find((t) => t.name === "users")!;
    expect(listUsers.return_type_relation_id).toBe(usersTable.id);
    expect(listUsers.is_set_returning_function).toBe(true);
  });
});

describe("end-to-end generateTypescript", () => {
  test("renders the expected Database type from the metadata block", async () => {
    const ts = await generateTypescript(metadataToGeneratorMetadata(block), {
      detectOneToOneRelationships: true,
    });
    expect(ts).toMatchInlineSnapshot(`
      "export type Json =
        | string
        | number
        | boolean
        | null
        | { [key: string]: Json | undefined }
        | Json[]

      export type Database = {
        public: {
          Tables: {
            todos: {
              Row: {
                details: string | null
                id: number
                user_id: number
                details_length: number | null
              }
              Insert: {
                details?: string | null
                id?: never
                user_id: number
              }
              Update: {
                details?: string | null
                id?: never
                user_id?: number
              }
              Relationships: [
                {
                  foreignKeyName: "todos_user_id_fkey"
                  columns: ["user_id"]
                  isOneToOne: false
                  referencedRelation: "users"
                  referencedColumns: ["id"]
                },
              ]
            }
            users: {
              Row: {
                home: Database["public"]["CompositeTypes"]["point3d"] | null
                id: number
                name: string | null
                status: Database["public"]["Enums"]["user_status"] | null
              }
              Insert: {
                home?: Database["public"]["CompositeTypes"]["point3d"] | null
                id?: number
                name?: string | null
                status?: Database["public"]["Enums"]["user_status"] | null
              }
              Update: {
                home?: Database["public"]["CompositeTypes"]["point3d"] | null
                id?: number
                name?: string | null
                status?: Database["public"]["Enums"]["user_status"] | null
              }
              Relationships: []
            }
          }
          Views: {
            active_users: {
              Row: {
                id: number | null
                name: string | null
              }
              Relationships: []
            }
          }
          Functions: {
            add: { Args: { a: number; b: number }; Returns: number }
            details_length: {
              Args: { "": Database["public"]["Tables"]["todos"]["Row"] }
              Returns: {
                error: true
              } & "the function public.details_length with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
            }
            list_users: {
              Args: never
              Returns: {
                home: Database["public"]["CompositeTypes"]["point3d"] | null
                id: number
                name: string | null
                status: Database["public"]["Enums"]["user_status"] | null
              }
              SetofOptions: {
                from: "*"
                to: "users"
                isOneToOne: true
                isSetofReturn: true
              }
            }
          }
          Enums: {
            user_status: "ACTIVE" | "INACTIVE"
          }
          CompositeTypes: {
            point3d: {
              x: number | null
              y: number | null
              z: number | null
            }
          }
        }
      }

      type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

      type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

      export type Tables<
        DefaultSchemaTableNameOrOptions extends
          | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
          | { schema: keyof DatabaseWithoutInternals },
        TableName extends DefaultSchemaTableNameOrOptions extends {
          schema: keyof DatabaseWithoutInternals
        }
          ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
              DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
          : never = never,
      > = DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals
      }
        ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
            DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
            Row: infer R
          }
          ? R
          : never
        : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
              DefaultSchema["Views"])
          ? (DefaultSchema["Tables"] &
              DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
              Row: infer R
            }
            ? R
            : never
          : never

      export type TablesInsert<
        DefaultSchemaTableNameOrOptions extends
          | keyof DefaultSchema["Tables"]
          | { schema: keyof DatabaseWithoutInternals },
        TableName extends DefaultSchemaTableNameOrOptions extends {
          schema: keyof DatabaseWithoutInternals
        }
          ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
          : never = never,
      > = DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals
      }
        ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
            Insert: infer I
          }
          ? I
          : never
        : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
          ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
              Insert: infer I
            }
            ? I
            : never
          : never

      export type TablesUpdate<
        DefaultSchemaTableNameOrOptions extends
          | keyof DefaultSchema["Tables"]
          | { schema: keyof DatabaseWithoutInternals },
        TableName extends DefaultSchemaTableNameOrOptions extends {
          schema: keyof DatabaseWithoutInternals
        }
          ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
          : never = never,
      > = DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals
      }
        ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
            Update: infer U
          }
          ? U
          : never
        : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
          ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
              Update: infer U
            }
            ? U
            : never
          : never

      export type Enums<
        DefaultSchemaEnumNameOrOptions extends
          | keyof DefaultSchema["Enums"]
          | { schema: keyof DatabaseWithoutInternals },
        EnumName extends DefaultSchemaEnumNameOrOptions extends {
          schema: keyof DatabaseWithoutInternals
        }
          ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
          : never = never,
      > = DefaultSchemaEnumNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals
      }
        ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
        : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
          ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
          : never

      export type CompositeTypes<
        PublicCompositeTypeNameOrOptions extends
          | keyof DefaultSchema["CompositeTypes"]
          | { schema: keyof DatabaseWithoutInternals },
        CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
          schema: keyof DatabaseWithoutInternals
        }
          ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
          : never = never,
      > = PublicCompositeTypeNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals
      }
        ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
        : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
          ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
          : never

      export const Constants = {
        public: {
          Enums: {
            user_status: ["ACTIVE", "INACTIVE"],
          },
        },
      } as const
      "
    `);
  });
});
