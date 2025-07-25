import { AlterChange, quoteIdentifier } from "../../base.change.ts";
import type { Domain } from "../domain.model.ts";

/**
 * Alter a domain.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterdomain.html
 *
 * Synopsis
 * ```sql
 * ALTER DOMAIN name
 *     { SET DEFAULT expression | DROP DEFAULT }
 * ALTER DOMAIN name
 *     { SET | DROP } NOT NULL
 * ALTER DOMAIN name
 *     ADD domain_constraint [ NOT VALID ]
 * ALTER DOMAIN name
 *     DROP CONSTRAINT [ IF EXISTS ] constraint_name [ RESTRICT | CASCADE ]
 * ALTER DOMAIN name
 *     RENAME CONSTRAINT constraint_name TO new_constraint_name
 * ALTER DOMAIN name
 *     VALIDATE CONSTRAINT constraint_name
 * ALTER DOMAIN name
 *     OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER DOMAIN name
 *     RENAME TO new_name
 * ALTER DOMAIN name
 *     SET SCHEMA new_schema
 *
 * where domain_constraint is:
 *
 *     [ CONSTRAINT constraint_name ]
 *     { NOT NULL | CHECK (expression) }
 * ```
 */
export type AlterDomain =
  | AlterDomainSetDefault
  | AlterDomainDropDefault
  | AlterDomainSetNotNull
  | AlterDomainDropNotNull
  | AlterDomainChangeOwner
  | AlterDomainAddConstraint
  | AlterDomainDropConstraint
  | AlterDomainRenameConstraint
  | AlterDomainValidateConstraint;

/**
 * ALTER DOMAIN ... SET DEFAULT ...
 */
export class AlterDomainSetDefault extends AlterChange {
  public readonly main: Domain;
  public readonly branch: Domain;

  constructor(props: { main: Domain; branch: Domain }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    return `ALTER DOMAIN ${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)} SET DEFAULT ${this.branch.default_value}`;
  }
}

/**
 * ALTER DOMAIN ... DROP DEFAULT
 */
export class AlterDomainDropDefault extends AlterChange {
  public readonly main: Domain;
  public readonly branch: Domain;

  constructor(props: { main: Domain; branch: Domain }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    return `ALTER DOMAIN ${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)} DROP DEFAULT`;
  }
}

/**
 * ALTER DOMAIN ... SET NOT NULL
 */
export class AlterDomainSetNotNull extends AlterChange {
  public readonly main: Domain;
  public readonly branch: Domain;

  constructor(props: { main: Domain; branch: Domain }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    return `ALTER DOMAIN ${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)} SET NOT NULL`;
  }
}

/**
 * ALTER DOMAIN ... DROP NOT NULL
 */
export class AlterDomainDropNotNull extends AlterChange {
  public readonly main: Domain;
  public readonly branch: Domain;

  constructor(props: { main: Domain; branch: Domain }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    return `ALTER DOMAIN ${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)} DROP NOT NULL`;
  }
}

/**
 * ALTER DOMAIN ... OWNER TO ...
 */
export class AlterDomainChangeOwner extends AlterChange {
  public readonly main: Domain;
  public readonly branch: Domain;

  constructor(props: { main: Domain; branch: Domain }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    return `ALTER DOMAIN ${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)} OWNER TO ${quoteIdentifier(this.branch.owner)}`;
  }
}

/**
 * Dummy class for ADD CONSTRAINT (to be implemented when constraints are added to Domain)
 */
export class AlterDomainAddConstraint extends AlterChange {
  // TODO: Implement when constraints are tracked in Domain
  serialize(): string {
    throw new Error("AlterDomainAddConstraint.serialize not implemented");
  }
}

/**
 * Dummy class for DROP CONSTRAINT (to be implemented when constraints are added to Domain)
 */
export class AlterDomainDropConstraint extends AlterChange {
  // TODO: Implement when constraints are tracked in Domain
  serialize(): string {
    throw new Error("AlterDomainDropConstraint.serialize not implemented");
  }
}

/**
 * Dummy class for RENAME CONSTRAINT (to be implemented when constraints are added to Domain)
 */
export class AlterDomainRenameConstraint extends AlterChange {
  // TODO: Implement when constraints are tracked in Domain
  serialize(): string {
    throw new Error("AlterDomainRenameConstraint.serialize not implemented");
  }
}

/**
 * Dummy class for VALIDATE CONSTRAINT (to be implemented when constraints are added to Domain)
 */
export class AlterDomainValidateConstraint extends AlterChange {
  // TODO: Implement when constraints are tracked in Domain
  serialize(): string {
    throw new Error("AlterDomainValidateConstraint.serialize not implemented");
  }
}
