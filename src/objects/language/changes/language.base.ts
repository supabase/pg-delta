import { BaseChange } from "../../base.change.ts";
import type { Language } from "../language.model.ts";

abstract class BaseLanguageChange extends BaseChange {
  abstract readonly language: Language;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "language" = "language";
}

export abstract class CreateLanguageChange extends BaseLanguageChange {
  readonly operation = "create" as const;
}

export abstract class AlterLanguageChange extends BaseLanguageChange {
  readonly operation = "alter" as const;
}

export abstract class DropLanguageChange extends BaseLanguageChange {
  readonly operation = "drop" as const;
}
