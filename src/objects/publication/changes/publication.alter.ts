import { stableId } from "../../utils.ts";
import type {
  Publication,
  PublicationTableProps,
} from "../publication.model.ts";
import {
  formatPublicationObjects,
  formatPublicationTable,
  getPublicationOperations,
} from "../utils.ts";
import { AlterPublicationChange } from "./publication.base.ts";

export class AlterPublicationSetOptions extends AlterPublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;
  private readonly setPublish: boolean;
  private readonly setPublishViaPartitionRoot: boolean;

  constructor(props: {
    publication: Publication;
    setPublish: boolean;
    setPublishViaPartitionRoot: boolean;
  }) {
    super();
    this.publication = props.publication;
    this.setPublish = props.setPublish;
    this.setPublishViaPartitionRoot = props.setPublishViaPartitionRoot;
  }

  get requires() {
    return [this.publication.stableId];
  }

  serialize(): string {
    const assignments: string[] = [];

    if (this.setPublish) {
      const operations = getPublicationOperations(this.publication);
      assignments.push(`publish = '${operations.join(", ")}'`);
    }

    if (this.setPublishViaPartitionRoot) {
      assignments.push(
        `publish_via_partition_root = ${this.publication.publish_via_partition_root ? "true" : "false"}`,
      );
    }

    return `ALTER PUBLICATION ${this.publication.name} SET (${assignments.join(", ")})`;
  }
}

export class AlterPublicationSetForAllTables extends AlterPublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;

  constructor(props: { publication: Publication }) {
    super();
    this.publication = props.publication;
  }

  get requires() {
    return [this.publication.stableId];
  }

  serialize(): string {
    return `ALTER PUBLICATION ${this.publication.name} SET FOR ALL TABLES`;
  }
}

export class AlterPublicationSetList extends AlterPublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;

  constructor(props: { publication: Publication }) {
    super();
    this.publication = props.publication;
  }

  get requires() {
    const dependencies = new Set<string>();

    dependencies.add(this.publication.stableId);

    for (const table of this.publication.tables) {
      dependencies.add(stableId.table(table.schema, table.name));
      if (table.columns) {
        for (const column of table.columns) {
          dependencies.add(stableId.column(table.schema, table.name, column));
        }
      }
    }

    for (const schema of this.publication.schemas) {
      dependencies.add(stableId.schema(schema));
    }

    return Array.from(dependencies);
  }

  serialize(): string {
    const clauses = formatPublicationObjects(
      this.publication.tables,
      this.publication.schemas,
    );
    return `ALTER PUBLICATION ${this.publication.name} SET ${clauses.join(", ")}`;
  }
}

export class AlterPublicationAddTables extends AlterPublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;
  private readonly tables: PublicationTableProps[];

  constructor(props: {
    publication: Publication;
    tables: PublicationTableProps[];
  }) {
    super();
    this.publication = props.publication;
    this.tables = props.tables;
  }

  get requires() {
    const dependencies = new Set<string>();

    dependencies.add(this.publication.stableId);

    for (const table of this.tables) {
      dependencies.add(stableId.table(table.schema, table.name));
      if (table.columns) {
        for (const column of table.columns) {
          dependencies.add(stableId.column(table.schema, table.name, column));
        }
      }
    }
    return Array.from(dependencies);
  }

  serialize(): string {
    const clauses = this.tables.map((table) => formatPublicationTable(table));
    return `ALTER PUBLICATION ${this.publication.name} ADD ${clauses.join(", ")}`;
  }
}

export class AlterPublicationDropTables extends AlterPublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;
  private readonly tables: PublicationTableProps[];

  constructor(props: {
    publication: Publication;
    tables: PublicationTableProps[];
  }) {
    super();
    this.publication = props.publication;
    this.tables = props.tables;
  }

  get requires() {
    const dependencies = new Set<string>();

    dependencies.add(this.publication.stableId);

    for (const table of this.tables) {
      dependencies.add(stableId.table(table.schema, table.name));
    }

    return Array.from(dependencies);
  }

  serialize(): string {
    const targets = this.tables.map((table) => `${table.schema}.${table.name}`);
    return `ALTER PUBLICATION ${this.publication.name} DROP TABLE ${targets.join(", ")}`;
  }
}

export class AlterPublicationAddSchemas extends AlterPublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;
  private readonly schemas: string[];

  constructor(props: { publication: Publication; schemas: string[] }) {
    super();
    this.publication = props.publication;
    this.schemas = props.schemas;
  }

  get requires() {
    return [
      this.publication.stableId,
      ...this.schemas.map((schema) => stableId.schema(schema)),
    ];
  }

  serialize(): string {
    const clauses = this.schemas.map((schema) => `TABLES IN SCHEMA ${schema}`);
    return `ALTER PUBLICATION ${this.publication.name} ADD ${clauses.join(", ")}`;
  }
}

export class AlterPublicationDropSchemas extends AlterPublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;
  private readonly schemas: string[];

  constructor(props: { publication: Publication; schemas: string[] }) {
    super();
    this.publication = props.publication;
    this.schemas = props.schemas;
  }

  get requires() {
    return [
      this.publication.stableId,
      ...this.schemas.map((schema) => stableId.schema(schema)),
    ];
  }

  serialize(): string {
    const clauses = this.schemas.map((schema) => `TABLES IN SCHEMA ${schema}`);
    return `ALTER PUBLICATION ${this.publication.name} DROP ${clauses.join(", ")}`;
  }
}

export class AlterPublicationSetOwner extends AlterPublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;
  private readonly owner: string;

  constructor(props: { publication: Publication; owner: string }) {
    super();
    this.publication = props.publication;
    this.owner = props.owner;
  }

  get requires() {
    return [this.publication.stableId, stableId.role(this.owner)];
  }

  serialize(): string {
    return `ALTER PUBLICATION ${this.publication.name} OWNER TO ${this.owner}`;
  }
}
