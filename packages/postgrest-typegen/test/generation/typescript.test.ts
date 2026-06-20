import { describe, expect, test } from "bun:test";

import { generateTypescript as rawGenerateTypescript } from "../../src/generation/typescript.ts";
import { sortGeneratorMetadata } from "../../src/sort.ts";
import {
  baseColumn,
  baseFunction,
  baseRelationship,
  baseTable,
  buildMetadata,
  userStatusEnum,
} from "./fixtures.ts";

// Generators expect pre-sorted metadata (the caller applies the canonical sort
// pass); mirror that here so fixture construction order doesn't matter.
const generateTypescript = (
  metadata: Parameters<typeof rawGenerateTypescript>[0],
  opts?: Parameters<typeof rawGenerateTypescript>[1],
) => rawGenerateTypescript(sortGeneratorMetadata(metadata), opts);

describe("typescript typegen", () => {
  test("table Row/Insert/Update with enum, identity ALWAYS, default and nullable", async () => {
    const result = await generateTypescript(
      buildMetadata({
        tables: [baseTable()],
        columns: [
          baseColumn({
            name: "id",
            format: "int8",
            is_identity: true,
            identity_generation: "ALWAYS",
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
            name: "score",
            format: "int4",
            default_value: "0",
            ordinal_position: 4,
          }),
          baseColumn({
            name: "meta",
            format: "jsonb",
            is_nullable: true,
            ordinal_position: 5,
          }),
        ],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
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
            tickets: {
              Row: {
                id: number
                label: string
                meta: Json | null
                score: number
                status: Database["public"]["Enums"]["user_status"] | null
              }
              Insert: {
                id?: never
                label: string
                meta?: Json | null
                score?: number
                status?: Database["public"]["Enums"]["user_status"] | null
              }
              Update: {
                id?: never
                label?: string
                meta?: Json | null
                score?: number
                status?: Database["public"]["Enums"]["user_status"] | null
              }
              Relationships: []
            }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            user_status: "ACTIVE" | "INACTIVE"
          }
          CompositeTypes: {
            [_ in never]: never
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

  test("relationships without detectOneToOneRelationships omit isOneToOne", async () => {
    const result = await generateTypescript(
      buildMetadata({
        tables: [baseTable({ id: 1, name: "tickets" })],
        columns: [
          baseColumn({ table_id: 1, name: "owner_id", format: "int8" }),
        ],
        relationships: [baseRelationship()],
      }),
    );

    expect(result).not.toContain("isOneToOne");
    expect(result).toMatchInlineSnapshot(`
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
            tickets: {
              Row: {
                owner_id: number
              }
              Insert: {
                owner_id: number
              }
              Update: {
                owner_id?: number
              }
              Relationships: [
                {
                  foreignKeyName: "tickets_owner_id_fkey"
                  columns: ["owner_id"]
                  referencedRelation: "users"
                  referencedColumns: ["id"]
                },
              ]
            }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            user_status: "ACTIVE" | "INACTIVE"
          }
          CompositeTypes: {
            [_ in never]: never
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

  test("relationships with detectOneToOneRelationships include isOneToOne", async () => {
    const result = await generateTypescript(
      buildMetadata({
        tables: [baseTable({ id: 1, name: "tickets" })],
        columns: [
          baseColumn({ table_id: 1, name: "owner_id", format: "int8" }),
        ],
        relationships: [baseRelationship({ is_one_to_one: true })],
      }),
      { detectOneToOneRelationships: true },
    );

    expect(result).toContain("isOneToOne: true");
    expect(result).toMatchInlineSnapshot(`
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
            tickets: {
              Row: {
                owner_id: number
              }
              Insert: {
                owner_id: number
              }
              Update: {
                owner_id?: number
              }
              Relationships: [
                {
                  foreignKeyName: "tickets_owner_id_fkey"
                  columns: ["owner_id"]
                  isOneToOne: true
                  referencedRelation: "users"
                  referencedColumns: ["id"]
                },
              ]
            }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            user_status: "ACTIVE" | "INACTIVE"
          }
          CompositeTypes: {
            [_ in never]: never
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

  test("postgrestVersion emits __InternalSupabase.PostgrestVersion", async () => {
    const result = await generateTypescript(
      buildMetadata({
        tables: [baseTable()],
        columns: [baseColumn({ name: "id", format: "int8" })],
      }),
      { postgrestVersion: "12" },
    );

    expect(result).toContain('PostgrestVersion: "12"');
    expect(result).toMatchInlineSnapshot(`
      "export type Json =
        | string
        | number
        | boolean
        | null
        | { [key: string]: Json | undefined }
        | Json[]

      export type Database = {
        // Allows to automatically instantiate createClient with right options
        // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
        __InternalSupabase: {
          PostgrestVersion: "12"
        }
        public: {
          Tables: {
            tickets: {
              Row: {
                id: number
              }
              Insert: {
                id: number
              }
              Update: {
                id?: number
              }
              Relationships: []
            }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            user_status: "ACTIVE" | "INACTIVE"
          }
          CompositeTypes: {
            [_ in never]: never
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

  test("function signature with args and scalar return", async () => {
    const result = await generateTypescript(
      buildMetadata({
        functions: [
          baseFunction({
            name: "add",
            args: [
              { mode: "in", name: "a", type_id: 23, has_default: false },
              { mode: "in", name: "b", type_id: 23, has_default: true },
            ],
            argument_types: "a integer, b integer",
            return_type_id: 23,
            return_type: "integer",
          }),
        ],
        types: [
          userStatusEnum,
          {
            id: 23,
            name: "int4",
            schema: "pg_catalog",
            format: "int4",
            enums: [],
            attributes: [],
            comment: null,
            type_relation_id: null,
          },
        ],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
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
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            add: { Args: { a: number; b?: number }; Returns: number }
          }
          Enums: {
            user_status: "ACTIVE" | "INACTIVE"
          }
          CompositeTypes: {
            [_ in never]: never
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

  test("defaultSchema option targets a non-public schema", async () => {
    const result = await generateTypescript(
      buildMetadata({
        schemas: [{ id: 2, name: "api", owner: "postgres" }],
        tables: [baseTable({ id: 1, schema: "api", name: "widgets" })],
        columns: [
          baseColumn({
            table_id: 1,
            schema: "api",
            name: "id",
            format: "int8",
          }),
        ],
        types: [],
      }),
      { defaultSchema: "api" },
    );

    expect(result).toContain('Extract<keyof Database, "api">');
    expect(result).toMatchInlineSnapshot(`
      "export type Json =
        | string
        | number
        | boolean
        | null
        | { [key: string]: Json | undefined }
        | Json[]

      export type Database = {
        api: {
          Tables: {
            widgets: {
              Row: {
                id: number
              }
              Insert: {
                id: number
              }
              Update: {
                id?: number
              }
              Relationships: []
            }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
      }

      type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

      type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "api">]

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
        api: {
          Enums: {},
        },
      } as const
      "
    `);
  });
});
