import { describe, expect, test } from "bun:test";

import { generateSwift as rawGenerateSwift } from "../../src/generation/swift.ts";
import { sortGeneratorMetadata } from "../../src/sort.ts";
import {
  addressCompositeType,
  baseColumn,
  baseTable,
  baseView,
  buildMetadata,
  textType,
  userStatusEnum,
} from "./fixtures.ts";

// Generators expect pre-sorted metadata (the caller applies the canonical sort
// pass); mirror that here so fixture construction order doesn't matter.
const generateSwift = (
  metadata: Parameters<typeof rawGenerateSwift>[0],
  opts?: Parameters<typeof rawGenerateSwift>[1],
) => rawGenerateSwift(sortGeneratorMetadata(metadata), opts);

describe("swift typegen", () => {
  test("enum, struct operations, identity and CodingKeys", () => {
    const result = generateSwift(
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
        ],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "import Foundation
      import Supabase

      internal enum PublicSchema {
        internal enum UserStatus: String, Codable, Hashable, Sendable {
          case active = "ACTIVE"
          case inactive = "INACTIVE"
        }
        internal struct TicketsSelect: Codable, Hashable, Sendable, Identifiable {
          internal let id: Int64
          internal let label: String
          internal let status: UserStatus?
          internal enum CodingKeys: String, CodingKey {
            case id = "id"
            case label = "label"
            case status = "status"
          }
        }
        internal struct TicketsInsert: Codable, Hashable, Sendable, Identifiable {
          internal let id: Int64?
          internal let label: String
          internal let status: UserStatus?
          internal enum CodingKeys: String, CodingKey {
            case id = "id"
            case label = "label"
            case status = "status"
          }
        }
        internal struct TicketsUpdate: Codable, Hashable, Sendable, Identifiable {
          internal let id: Int64?
          internal let label: String?
          internal let status: UserStatus?
          internal enum CodingKeys: String, CodingKey {
            case id = "id"
            case label = "label"
            case status = "status"
          }
        }
      }"
    `);
  });

  test("views and composite types", () => {
    const result = generateSwift(
      buildMetadata({
        types: [userStatusEnum, textType, addressCompositeType],
        views: [baseView({ id: 2, name: "tickets_view" })],
        columns: [
          baseColumn({
            table_id: 2,
            name: "b",
            format: "int4",
            is_nullable: true,
          }),
        ],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "import Foundation
      import Supabase

      internal enum PublicSchema {
        internal enum UserStatus: String, Codable, Hashable, Sendable {
          case active = "ACTIVE"
          case inactive = "INACTIVE"
        }
        internal struct TicketsViewSelect: Codable, Hashable, Sendable {
          internal let b: Int32?
          internal enum CodingKeys: String, CodingKey {
            case b = "b"
          }
        }
        internal struct Address: Codable, Hashable, Sendable {
          internal let Street: String
          internal let City: String
          internal enum CodingKeys: String, CodingKey {
            case Street = "street"
            case City = "city"
          }
        }
      }"
    `);
  });

  test("accessControl: public", () => {
    const result = generateSwift(
      buildMetadata({
        tables: [baseTable()],
        columns: [baseColumn({ name: "id", format: "int8" })],
      }),
      { accessControl: "public" },
    );

    expect(result).toMatchInlineSnapshot(`
      "import Foundation
      import Supabase

      public enum PublicSchema {
        public enum UserStatus: String, Codable, Hashable, Sendable {
          case active = "ACTIVE"
          case inactive = "INACTIVE"
        }
        public struct TicketsSelect: Codable, Hashable, Sendable {
          public let id: Int64
          public enum CodingKeys: String, CodingKey {
            case id = "id"
          }
        }
        public struct TicketsInsert: Codable, Hashable, Sendable {
          public let id: Int64
          public enum CodingKeys: String, CodingKey {
            case id = "id"
          }
        }
        public struct TicketsUpdate: Codable, Hashable, Sendable {
          public let id: Int64?
          public enum CodingKeys: String, CodingKey {
            case id = "id"
          }
        }
      }"
    `);
  });

  test("array and uuid types", () => {
    const result = generateSwift(
      buildMetadata({
        tables: [baseTable()],
        columns: [
          baseColumn({ name: "id", format: "uuid", ordinal_position: 1 }),
          baseColumn({
            name: "tags",
            format: "_text",
            is_nullable: true,
            ordinal_position: 2,
          }),
        ],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "import Foundation
      import Supabase

      internal enum PublicSchema {
        internal enum UserStatus: String, Codable, Hashable, Sendable {
          case active = "ACTIVE"
          case inactive = "INACTIVE"
        }
        internal struct TicketsSelect: Codable, Hashable, Sendable {
          internal let id: UUID
          internal let tags: [String]?
          internal enum CodingKeys: String, CodingKey {
            case id = "id"
            case tags = "tags"
          }
        }
        internal struct TicketsInsert: Codable, Hashable, Sendable {
          internal let id: UUID
          internal let tags: [String]?
          internal enum CodingKeys: String, CodingKey {
            case id = "id"
            case tags = "tags"
          }
        }
        internal struct TicketsUpdate: Codable, Hashable, Sendable {
          internal let id: UUID?
          internal let tags: [String]?
          internal enum CodingKeys: String, CodingKey {
            case id = "id"
            case tags = "tags"
          }
        }
      }"
    `);
  });
});
