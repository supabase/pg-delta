import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { Server } from "../server.model.ts";
import { CreateServerChange, DropServerChange } from "./server.base.ts";

/**
 * Create/drop comments on servers.
 */

export type CommentServer = CreateCommentOnServer | DropCommentOnServer;

export class CreateCommentOnServer extends CreateServerChange {
  public readonly server: Server;
  public readonly scope = "comment" as const;

  constructor(props: { server: Server }) {
    super();
    this.server = props.server;
  }

  get creates() {
    return [stableId.comment(this.server.stableId)];
  }

  get requires() {
    return [this.server.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON SERVER",
      this.server.name,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: comment is not nullable in this case
      quoteLiteral(this.server.comment!),
    ].join(" ");
  }
}

export class DropCommentOnServer extends DropServerChange {
  public readonly server: Server;
  public readonly scope = "comment" as const;

  constructor(props: { server: Server }) {
    super();
    this.server = props.server;
  }

  get drops() {
    return [stableId.comment(this.server.stableId)];
  }

  get requires() {
    return [stableId.comment(this.server.stableId), this.server.stableId];
  }

  serialize(): string {
    return ["COMMENT ON SERVER", this.server.name, "IS NULL"].join(" ");
  }
}
