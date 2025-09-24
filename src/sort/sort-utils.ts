import type { Change } from "../objects/base.change.ts";

export type Rule = Partial<Pick<Change, "operation" | "objectType" | "scope">>;

export function createComparatorFromRules(rules: Rule[]) {
  const matchIndex = (change: Change): number => {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (
        (rule.operation === undefined || rule.operation === change.operation) &&
        (rule.objectType === undefined ||
          rule.objectType === change.objectType) &&
        (rule.scope === undefined || rule.scope === change.scope)
      ) {
        return i; // earlier rule = higher priority
      }
    }
    return Number.POSITIVE_INFINITY; // no rule matched
  };

  return (a: Change, b: Change): number => {
    const ra = matchIndex(a);
    const rb = matchIndex(b);
    if (ra !== rb) return ra - rb;
    // no rule tie-break: keep input order by not breaking ties here
    return 0;
  };
}

export function sortChangesByRules<T extends Change>(
  changes: T[],
  rules: Rule[],
): T[] {
  const compare = createComparatorFromRules(rules);
  // stable sort: include original index as tie-breaker
  return changes
    .map((change, idx) => ({ change, idx }))
    .sort((a, b) => {
      const cmp = compare(a.change, b.change);
      return cmp !== 0 ? cmp : a.idx - b.idx;
    })
    .map(({ change }) => change);
}
