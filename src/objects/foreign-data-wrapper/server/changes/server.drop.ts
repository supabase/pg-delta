import type { Server } from "../server.model.ts";
import { DropServerChange } from "./server.base.ts";

/**
 * Drop a server.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropserver.html
 *
 * Synopsis
 * ```sql
 * DROP SERVER [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropServer extends DropServerChange {
  public readonly server: Server;
  public readonly scope = "object" as const;

  constructor(props: { server: Server }) {
    super();
    this.server = props.server;
  }

  get drops() {
    return [this.server.stableId];
  }

  get requires() {
    return [this.server.stableId];
  }

  serialize(): string {
    return ["DROP SERVER", this.server.name].join(" ");
  }
}
