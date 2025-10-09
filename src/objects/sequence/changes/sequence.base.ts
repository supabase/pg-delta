import { BaseChange } from "../../base.change.ts";
import type { Sequence } from "../sequence.model.ts";

abstract class BaseSequenceChange extends BaseChange {
  abstract readonly sequence: Sequence;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "sequence" = "sequence";
}

export abstract class CreateSequenceChange extends BaseSequenceChange {
  readonly operation = "create" as const;
}

export abstract class AlterSequenceChange extends BaseSequenceChange {
  readonly operation = "alter" as const;
}

export abstract class DropSequenceChange extends BaseSequenceChange {
  readonly operation = "drop" as const;
}
