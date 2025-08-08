import type { Sql } from "postgres";

export interface ColumnProps {
  name: string;
  position: number;
  data_type: string;
  data_type_str: string;
  is_custom_type: boolean;
  custom_type_type: string | null;
  custom_type_category: string | null;
  custom_type_schema: string | null;
  custom_type_name: string | null;
  not_null: boolean;
  is_identity: boolean;
  is_identity_always: boolean;
  is_generated: boolean;
  collation: string | null;
  default: string | null;
  comment: string | null;
}

/**
 * Interface for table-like objects that have columns (tables, views, materialized views).
 * In PostgreSQL, these are relations with relkind in ('r', 'p', 'v', 'm').
 */
export interface TableLikeObject {
  readonly columns: ColumnProps[];
}

export abstract class BasePgModel {
  /**
   * Database-portable stable identifier for dependency resolution.
   * This identifier remains constant across database dumps/restores and
   * is used for cross-database dependency resolution.
   */
  abstract get stableId(): string;

  /**
   * Get all identity fields and their values.
   * Subclasses should override this to return the identity fields.
   */
  abstract get identityFields(): Record<string, unknown>;

  /**
   * Get all data fields and their values.
   * Subclasses should override this to return the data fields.
   */
  abstract get dataFields(): Record<string, unknown>;

  /**
   * Compare this object with another BasePgModel for equality based on stableId and dataFields.
   */
  equals(other: BasePgModel): boolean {
    return (
      this.stableId === other.stableId &&
      JSON.stringify(this.dataFields) === JSON.stringify(other.dataFields)
    );
  }
}
