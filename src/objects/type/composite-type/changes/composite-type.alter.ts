import type { CompositeType } from "../composite-type.model.ts";
import { AlterCompositeTypeChange } from "./composite-type.base.ts";

/**
 * Alter a composite type.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertype.html
 *
 * Synopsis
 * ```sql
 * ALTER TYPE name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER TYPE name RENAME TO new_name
 * ALTER TYPE name SET SCHEMA new_schema
 * -- Attribute actions (composite types):
 * ALTER TYPE name ADD ATTRIBUTE attribute_name data_type [ COLLATE collation ] [ CASCADE | RESTRICT ]
 * ALTER TYPE name DROP ATTRIBUTE [ IF EXISTS ] attribute_name [ CASCADE | RESTRICT ]
 * ALTER TYPE name ALTER ATTRIBUTE attribute_name [ SET DATA ] TYPE data_type [ COLLATE collation ] [ CASCADE | RESTRICT ]
 * ```
 */

export type AlterCompositeType =
  | AlterCompositeTypeAddAttribute
  | AlterCompositeTypeAlterAttributeType
  | AlterCompositeTypeChangeOwner
  | AlterCompositeTypeDropAttribute;

/**
 * ALTER TYPE ... OWNER TO ...
 */
export class AlterCompositeTypeChangeOwner extends AlterCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { compositeType: CompositeType; owner: string }) {
    super();
    this.compositeType = props.compositeType;
    this.owner = props.owner;
  }

  get requires() {
    return [this.compositeType.stableId];
  }

  serialize(): string {
    return [
      "ALTER TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
      "OWNER TO",
      this.owner,
    ].join(" ");
  }
}

/**
 * ALTER TYPE ... ADD ATTRIBUTE ...
 */
export class AlterCompositeTypeAddAttribute extends AlterCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: CompositeType["columns"][number];
  public readonly scope = "object" as const;

  constructor(props: {
    compositeType: CompositeType;
    attribute: CompositeType["columns"][number];
  }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get creates() {
    return [`${this.compositeType.stableId}:${this.attribute.name}`];
  }

  get requires() {
    return [this.compositeType.stableId];
  }

  serialize(): string {
    const parts = [
      "ALTER TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
      "ADD ATTRIBUTE",
      this.attribute.name,
      this.attribute.data_type_str,
    ];
    if (this.attribute.collation) {
      parts.push("COLLATE", this.attribute.collation);
    }
    return parts.join(" ");
  }
}

/**
 * ALTER TYPE ... DROP ATTRIBUTE ...
 */
export class AlterCompositeTypeDropAttribute extends AlterCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: CompositeType["columns"][number];
  public readonly scope = "object" as const;

  constructor(props: {
    compositeType: CompositeType;
    attribute: CompositeType["columns"][number];
  }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get requires() {
    return [
      `${this.compositeType.stableId}:${this.attribute.name}`,
      this.compositeType.stableId,
    ];
  }

  serialize(): string {
    return [
      "ALTER TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
      "DROP ATTRIBUTE",
      this.attribute.name,
    ].join(" ");
  }
}

/**
 * ALTER TYPE ... ALTER ATTRIBUTE ... TYPE ... [ COLLATE ... ]
 */
export class AlterCompositeTypeAlterAttributeType extends AlterCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: CompositeType["columns"][number];
  public readonly scope = "object" as const;

  constructor(props: {
    compositeType: CompositeType;
    attribute: CompositeType["columns"][number];
  }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get requires() {
    return [
      `${this.compositeType.stableId}:${this.attribute.name}`,
      this.compositeType.stableId,
    ];
  }

  serialize(): string {
    const parts = [
      "ALTER TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
      "ALTER ATTRIBUTE",
      this.attribute.name,
      "TYPE",
      this.attribute.data_type_str,
    ];
    if (this.attribute.collation) {
      parts.push("COLLATE", this.attribute.collation);
    }
    return parts.join(" ");
  }
}

/**
 * Replace a composite type by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER TYPE change.
 * Note: Attribute list changes are modeled as drop+create via diff.
 */
// NOTE: ReplaceCompositeType removed. Non-alterable changes are emitted as Drop + Create in composite-type.diff.ts.
