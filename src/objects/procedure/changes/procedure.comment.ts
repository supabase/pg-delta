import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Procedure } from "../procedure.model.ts";
import {
  CreateProcedureChange,
  DropProcedureChange,
} from "./procedure.base.ts";

export type CommentProcedure =
  | CreateCommentOnProcedure
  | DropCommentOnProcedure;

/**
 * Create/drop comments on procedures/functions.
 */
export class CreateCommentOnProcedure extends CreateProcedureChange {
  public readonly procedure: Procedure;
  public readonly scope = "comment" as const;

  constructor(props: { procedure: Procedure }) {
    super();
    this.procedure = props.procedure;
  }

  get creates() {
    return [stableId.comment(this.procedure.stableId)];
  }

  get requires() {
    return [this.procedure.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON",
      this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION",
      `${this.procedure.schema}.${this.procedure.name}(${(this.procedure.argument_types ?? []).join(",")})`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: procedure comment is not nullable in this case
      quoteLiteral(this.procedure.comment!),
    ].join(" ");
  }
}

export class DropCommentOnProcedure extends DropProcedureChange {
  public readonly procedure: Procedure;
  public readonly scope = "comment" as const;

  constructor(props: { procedure: Procedure }) {
    super();
    this.procedure = props.procedure;
  }

  get drops() {
    return [stableId.comment(this.procedure.stableId)];
  }

  get requires() {
    return [stableId.comment(this.procedure.stableId), this.procedure.stableId];
  }

  serialize(): string {
    return [
      "COMMENT ON",
      this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION",
      `${this.procedure.schema}.${this.procedure.name}(${(this.procedure.argument_types ?? []).join(",")})`,
      "IS NULL",
    ].join(" ");
  }
}
