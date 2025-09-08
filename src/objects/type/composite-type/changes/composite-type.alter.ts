import { AlterChange, ReplaceChange } from "../../../base.change.ts";
import type { CompositeType } from "../composite-type.model.ts";
import { CreateCompositeType } from "./composite-type.create.ts";
import { DropCompositeType } from "./composite-type.drop.ts";

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
  | AlterCompositeTypeChangeOwner
  | AlterCompositeTypeAddAttribute
  | AlterCompositeTypeDropAttribute
  | AlterCompositeTypeAlterAttributeType;

/**
 * ALTER TYPE ... OWNER TO ...
 */
export class AlterCompositeTypeChangeOwner extends AlterChange {
  public readonly main: CompositeType;
  public readonly branch: CompositeType;

  constructor(props: { main: CompositeType; branch: CompositeType }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER TYPE",
      `${this.main.schema}.${this.main.name}`,
      "OWNER TO",
      this.branch.owner,
    ].join(" ");
  }
}

/**
 * ALTER TYPE ... ADD ATTRIBUTE ...
 */
export class AlterCompositeTypeAddAttribute extends AlterChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: CompositeType["columns"][number];

  constructor(props: {
    compositeType: CompositeType;
    attribute: CompositeType["columns"][number];
  }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get stableId(): string {
    return `${this.compositeType.stableId}:${this.attribute.name}`;
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
export class AlterCompositeTypeDropAttribute extends AlterChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: CompositeType["columns"][number];

  constructor(props: {
    compositeType: CompositeType;
    attribute: CompositeType["columns"][number];
  }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get stableId(): string {
    return `${this.compositeType.stableId}:${this.attribute.name}`;
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
export class AlterCompositeTypeAlterAttributeType extends AlterChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: CompositeType["columns"][number];

  constructor(props: {
    compositeType: CompositeType;
    attribute: CompositeType["columns"][number];
  }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get stableId(): string {
    return `${this.compositeType.stableId}:${this.attribute.name}`;
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
export class ReplaceCompositeType extends ReplaceChange {
  public readonly main: CompositeType;
  public readonly branch: CompositeType;

  constructor(props: { main: CompositeType; branch: CompositeType }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropCompositeType({ compositeType: this.main });
    const createChange = new CreateCompositeType({
      compositeType: this.branch,
    });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
