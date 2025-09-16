import { CreateChange } from "../../../base.change.ts";
import type { Range } from "../range.model.ts";

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
export class CreateRange extends CreateChange {
  public readonly range: Range;

  constructor(props: { range: Range }) {
    super();
    this.range = props.range;
  }

  get dependencies() {
    return [this.range.stableId];
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
