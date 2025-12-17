import type { Change } from "../change.types.ts";
import { getSchema } from "../integrations/filter/extractors.ts";
import {
  GrantRoleDefaultPrivileges,
  RevokeRoleDefaultPrivileges,
} from "../objects/role/changes/role.privilege.ts";
import type { Constraint } from "./types.ts";

/**
 * Maps object type names to PostgreSQL default privilege objtype codes.
 * This mirrors the mapping in base.default-privileges.ts.
 */
function objectTypeToObjtype(objectType: string): string | null {
  switch (objectType) {
    case "table":
    case "view":
    case "materialized_view":
      return "r"; // Relations
    case "sequence":
      return "S"; // Sequences
    case "procedure":
    case "function":
    case "aggregate":
      return "f"; // Functions/routines
    case "type":
    case "domain":
    case "enum":
    case "range":
    case "composite_type":
      return "T"; // Types
    case "schema":
      return "n"; // Schemas
    default:
      return null;
  }
}

/**
 * A function that generates constraints for a list of changes.
 * Should be optimized to avoid O(N²) complexity by using lookups/indexing.
 */
type ConstraintGenerator = (changes: Change[]) => Constraint[];

/**
 * Generate constraints to ensure ALTER DEFAULT PRIVILEGES comes before CREATE statements.
 *
 * Rules:
 * - Only applies when the default privilege's schema matches the CREATE statement's schema
 *   (or if the default privilege is global, applies to all schemas)
 * - Only applies when the default privilege's objtype matches the CREATE statement's object type
 * - Excludes CREATE ROLE and CREATE SCHEMA since they are dependencies
 *   of ALTER DEFAULT PRIVILEGES and must come before it
 *
 * implementation: O(N) using schema/objtype indexing.
 */
function generateDefaultPrivilegeConstraints(changes: Change[]): Constraint[] {
  const constraints: Constraint[] = [];
  const defaultPrivilegeIndices: number[] = [];
  // Map<objtype_code, Map<schema_name, index[]>>
  const createsByObjTypeAndSchema = new Map<string, Map<string, number[]>>();

  // Pass 1: Index changes
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    // Identify default privilege changes
    if (
      change instanceof GrantRoleDefaultPrivileges ||
      change instanceof RevokeRoleDefaultPrivileges
    ) {
      defaultPrivilegeIndices.push(i);
      continue;
    }

    // Identify CREATE object changes (excluding role/schema)
    if (
      change.operation === "create" &&
      change.scope === "object" &&
      change.objectType !== "role" &&
      change.objectType !== "schema"
    ) {
      const objTypeCode = objectTypeToObjtype(change.objectType);
      if (!objTypeCode) continue;

      const schema = getSchema(change);
      // Default privileges only apply to schema-contained objects.
      if (schema) {
        let schemaMap = createsByObjTypeAndSchema.get(objTypeCode);
        if (!schemaMap) {
          schemaMap = new Map();
          createsByObjTypeAndSchema.set(objTypeCode, schemaMap);
        }

        let indices = schemaMap.get(schema);
        if (!indices) {
          indices = [];
          schemaMap.set(schema, indices);
        }
        indices.push(i);
      }
    }
  }

  // Pass 2: Generate constraints
  for (const privIndex of defaultPrivilegeIndices) {
    const privChange = changes[privIndex] as {
      inSchema: string | null;
      objtype: string;
    };
    const privSchema = privChange.inSchema;
    const privObjType = privChange.objtype;

    const schemaMap = createsByObjTypeAndSchema.get(privObjType);
    if (!schemaMap) continue;

    if (privSchema === null) {
      // Global default privilege: applies to ALL schemas
      for (const indices of schemaMap.values()) {
        for (const createIndex of indices) {
          // (No self-check needed as types differ)
          constraints.push({
            sourceChangeIndex: privIndex,
            targetChangeIndex: createIndex,
            source: "custom",
          });
        }
      }
    } else {
      // Specific schema: applies only to that schema
      const indices = schemaMap.get(privSchema);
      if (indices) {
        for (const createIndex of indices) {
          constraints.push({
            sourceChangeIndex: privIndex,
            targetChangeIndex: createIndex,
            source: "custom",
          });
        }
      }
    }
  }

  return constraints;
}

/**
 * All custom constraint generators.
 */
const customConstraintGenerators: ConstraintGenerator[] = [
  generateDefaultPrivilegeConstraints,
];

/**
 * Generate Constraints from custom constraint generators.
 *
 * Iterates through registered generators to produce constraints.
 * Generators should be optimized (e.g. using indexing) to avoid O(N²) complexity.
 */
export function generateCustomConstraints(changes: Change[]): Constraint[] {
  return customConstraintGenerators.flatMap((generate) => generate(changes));
}
