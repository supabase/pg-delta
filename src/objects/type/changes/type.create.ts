import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Type } from "../type.model.ts";

/**
 * Create a type.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtype.html
 *
 * Synopsis
 * ```sql
 * CREATE TYPE name AS (
 *     attribute_name data_type [ COLLATE collation ] [ NOT NULL ] [ DEFAULT default_expr ] [, ... ]
 * )
 *
 * CREATE TYPE name AS ENUM ( [ label [, ...] ] )
 *
 * CREATE TYPE name AS RANGE (
 *     SUBTYPE = subtype
 *     [ , SUBTYPE_OPCLASS = subtype_operator_class ]
 *     [ , COLLATION = collation ]
 *     [ , CANONICAL = canonical_function ]
 *     [ , SUBTYPE_DIFF = subtype_diff_function ]
 * )
 *
 * CREATE TYPE name (
 *     INPUT = input_function,
 *     OUTPUT = output_function
 *     [ , RECEIVE = receive_function ]
 *     [ , SEND = send_function ]
 *     [ , TYPMOD_IN = type_modifier_input_function ]
 *     [ , TYPMOD_OUT = type_modifier_output_function ]
 *     [ , ANALYZE = analyze_function ]
 *     [ , INTERNALLENGTH = { internallength | VARIABLE } ]
 *     [ , PASSEDBYVALUE ]
 *     [ , ALIGNMENT = alignment ]
 *     [ , STORAGE = storage ]
 *     [ , LIKE = like_type ]
 *     [ , CATEGORY = category ]
 *     [ , PREFERRED = preferred ]
 *     [ , DEFAULT = default ]
 *     [ , ELEMENT = element ]
 *     [ , DELIMITER = delimiter ]
 *     [ , COLLATABLE = collatable ]
 * )
 * ```
 */
export class CreateType extends CreateChange {
  public readonly type: Type;

  constructor(props: { type: Type }) {
    super();
    this.type = props.type;
  }

  serialize(): string {
    const parts: string[] = ["CREATE TYPE"];

    // Add schema and name
    parts.push(
      `${quoteIdentifier(this.type.schema)}.${quoteIdentifier(this.type.name)}`,
    );

    // Add type-specific syntax based on type type
    switch (this.type.type_type) {
      case "c":
        parts.push("AS ()"); // Composite type
        break;
      case "e":
        parts.push("AS ENUM ()"); // Enum type
        break;
      case "d":
        parts.push("AS RANGE ()"); // Range type
        break;
      case "b": {
        // Base type - no AS keyword, no options for minimal creation
        // Options would be included only when explicitly needed
        break;
      }
      case "p":
        // Pseudo type - no options needed
        break;
      default:
        parts.push("AS ()");
    }

    return parts.join(" ");
  }
}
