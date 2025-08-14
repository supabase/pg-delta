import { AlterChange, quoteIdentifier } from "../../base.change.ts";
import type { Domain, DomainConstraintProps } from "../domain.model.ts";

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
  public readonly domain: Domain;
  public readonly constraint: DomainConstraintProps;

  constructor(props: { domain: Domain; constraint: DomainConstraintProps }) {
    super();
    this.domain = props.domain;
    this.constraint = props.constraint;
  }

  serialize(): string {
    const domainName = `${quoteIdentifier(this.domain.schema)}.${quoteIdentifier(this.domain.name)}`;
    const parts: string[] = [
      "ALTER DOMAIN",
      domainName,
      "ADD CONSTRAINT",
      quoteIdentifier(this.constraint.name),
      "CHECK",
    ];
    if (this.constraint.check_expression) {
      parts.push(`(${this.constraint.check_expression})`);
    }
    if (!this.constraint.validated) {
      parts.push("NOT VALID");
    }
    return parts.join(" ");
  }
}

/**
 * Dummy class for DROP CONSTRAINT (to be implemented when constraints are added to Domain)
 */
export class AlterDomainDropConstraint extends AlterChange {
  public readonly domain: Domain;
  public readonly constraint: DomainConstraintProps;

  constructor(props: { domain: Domain; constraint: DomainConstraintProps }) {
    super();
    this.domain = props.domain;
    this.constraint = props.constraint;
  }

  serialize(): string {
    const domainName = `${quoteIdentifier(this.domain.schema)}.${quoteIdentifier(this.domain.name)}`;
    return [
      "ALTER DOMAIN",
      domainName,
      "DROP CONSTRAINT",
      quoteIdentifier(this.constraint.name),
    ].join(" ");
  }
}

/**
 * Dummy class for RENAME CONSTRAINT (to be implemented when constraints are added to Domain)
 */
// Note: Domain constraint renames are modeled as drop+add because the
// constraint name is part of the identity used in diffing and deps.

/**
 * Dummy class for VALIDATE CONSTRAINT (to be implemented when constraints are added to Domain)
 */
export class AlterDomainValidateConstraint extends AlterChange {
  public readonly domain: Domain;
  public readonly constraint: DomainConstraintProps;

  constructor(props: { domain: Domain; constraint: DomainConstraintProps }) {
    super();
    this.domain = props.domain;
    this.constraint = props.constraint;
  }

  serialize(): string {
    const domainName = `${quoteIdentifier(this.domain.schema)}.${quoteIdentifier(this.domain.name)}`;
    return [
      "ALTER DOMAIN",
      domainName,
      "VALIDATE CONSTRAINT",
      quoteIdentifier(this.constraint.name),
    ].join(" ");
  }
}
