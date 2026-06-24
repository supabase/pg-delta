type KeywordCase = "upper" | "lower" | "preserve";
export type CommaStyle = "trailing" | "leading";

export type SqlFormatOptions = {
  keywordCase?: KeywordCase;
  indent?: number;
  maxWidth?: number;
  commaStyle?: CommaStyle;
  alignColumns?: boolean;
  alignKeyValues?: boolean;
  preserveRoutineBodies?: boolean;
  preserveViewBodies?: boolean;
  preserveRuleBodies?: boolean;
};

export type NormalizedOptions = Required<SqlFormatOptions>;

export type Token = {
  value: string;
  upper: string;
  start: number;
  end: number;
  depth: number;
};

export type ProtectedSegments = {
  text: string;
  placeholders: Map<string, string>;
  noWrapPlaceholders: Set<string>;
  skipCasing: boolean;
};
