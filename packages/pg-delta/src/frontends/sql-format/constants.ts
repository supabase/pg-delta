import type { NormalizedOptions } from "./types.ts";

export const DEFAULT_OPTIONS: NormalizedOptions = {
  keywordCase: "preserve",
  indent: 2,
  maxWidth: 100,
  commaStyle: "trailing",
  alignColumns: true,
  alignKeyValues: true,
  preserveRoutineBodies: true,
  preserveViewBodies: true,
  preserveRuleBodies: true,
};
