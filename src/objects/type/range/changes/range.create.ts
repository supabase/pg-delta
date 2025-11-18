import {
  isUserDefinedTypeSchema,
  parseProcedureReference,
  stableId,
} from "../../../utils.ts";
import type { Range } from "../range.model.ts";
import { CreateRangeChange } from "./range.base.ts";

/**
 * Create a range type.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtype.html
 *
 * Synopsis
 * ```sql
 * CREATE TYPE name AS RANGE (
 *   SUBTYPE = subtype
 *   [ , SUBTYPE_OPCLASS = subtype_operator_class ]
 *   [ , COLLATION = collation ]
 *   [ , CANONICAL = canonical_function ]
 *   [ , SUBTYPE_DIFF = subtype_diff_function ]
 * )
 * ```
 *
 * Notes
 * - Only non-default options are emitted in the generated SQL.
 */
export class CreateRange extends CreateRangeChange {
  public readonly range: Range;
  public readonly scope = "object" as const;

  constructor(props: { range: Range }) {
    super();
    this.range = props.range;
  }

  get creates() {
    return [this.range.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.range.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.range.owner));

    // Subtype dependency (if user-defined)
    if (
      this.range.subtype_schema &&
      isUserDefinedTypeSchema(this.range.subtype_schema)
    ) {
      // subtype_str is the type name without schema (e.g., "integer", "text")
      // subtype_schema is the schema name
      dependencies.add(
        stableId.type(this.range.subtype_schema, this.range.subtype_str),
      );
    }

    // Canonical function dependency
    if (
      this.range.canonical_function_schema &&
      this.range.canonical_function_name
    ) {
      const procRef = parseProcedureReference(
        `${this.range.canonical_function_schema}.${this.range.canonical_function_name}()`,
      );
      if (procRef) {
        dependencies.add(
          `procedure:${procRef.schema}.${procRef.name}()` as string,
        );
      }
    }

    // Subtype diff function dependency
    if (this.range.subtype_diff_schema && this.range.subtype_diff_name) {
      const procRef = parseProcedureReference(
        `${this.range.subtype_diff_schema}.${this.range.subtype_diff_name}()`,
      );
      if (procRef) {
        dependencies.add(
          `procedure:${procRef.schema}.${procRef.name}()` as string,
        );
      }
    }

    // Collation dependency (if non-default and user-defined)
    if (this.range.collation) {
      const unquotedCollation = this.range.collation.replace(/^"|"$/g, "");
      const collationParts = unquotedCollation.split(".");
      if (collationParts.length === 2) {
        const [collationSchema, collationName] = collationParts;
        if (isUserDefinedTypeSchema(collationSchema)) {
          dependencies.add(stableId.collation(collationSchema, collationName));
        }
      }
    }

    return Array.from(dependencies);
  }

  serialize(): string {
    const name = `${this.range.schema}.${this.range.name}`;
    const prefix: string = ["CREATE TYPE", name, "AS RANGE"].join(" ");

    const opts: string[] = [];

    // Required subtype
    const subtypeQualified =
      this.range.subtype_schema && this.range.subtype_schema !== "pg_catalog"
        ? `${this.range.subtype_schema}.${this.range.subtype_str}`
        : this.range.subtype_str;
    opts.push(`SUBTYPE = ${subtypeQualified}`);

    // Optional opclass
    if (this.range.subtype_opclass_name) {
      const opclassQualified =
        this.range.subtype_opclass_schema &&
        this.range.subtype_opclass_schema !== "pg_catalog"
          ? `${this.range.subtype_opclass_schema}.${this.range.subtype_opclass_name}`
          : this.range.subtype_opclass_name;
      opts.push(`SUBTYPE_OPCLASS = ${opclassQualified}`);
    }

    // Optional collation
    if (this.range.collation) {
      opts.push(`COLLATION = ${this.range.collation}`);
    }

    // Optional canonical function
    if (this.range.canonical_function_name) {
      const canonQualified =
        this.range.canonical_function_schema &&
        this.range.canonical_function_schema !== "pg_catalog"
          ? `${this.range.canonical_function_schema}.${this.range.canonical_function_name}`
          : this.range.canonical_function_name;
      opts.push(`CANONICAL = ${canonQualified}`);
    }

    // Optional subtype diff function
    if (this.range.subtype_diff_name) {
      const diffQualified =
        this.range.subtype_diff_schema &&
        this.range.subtype_diff_schema !== "pg_catalog"
          ? `${this.range.subtype_diff_schema}.${this.range.subtype_diff_name}`
          : this.range.subtype_diff_name;
      opts.push(`SUBTYPE_DIFF = ${diffQualified}`);
    }

    const body = `(${opts.join(", ")})`;
    return `${prefix} ${body}`;
  }
}
