/**
 * The EXPECTED_RED ledger (stage 0): scenarios whose engine support has not
 * landed yet. A listed test MUST fail (red = engine missing, pinned); an
 * accidentally-green listed test fails the suite so flipping an entry is
 * always a deliberate one-line diff.
 *
 * Keys are scenario directory names; a `:reverse` suffix pins only the
 * teardown direction. A pin with `minMajor` applies only on PostgreSQL
 * majors >= that version — on older majors the scenario runs normally and
 * must PASS (version-dependent server behavior, e.g. PG16 dependent-privilege
 * tracking).
 */
export interface RedPin {
  /** Pin applies only when the server major is >= this (absent = all). */
  minMajor?: number;
}

export const EXPECTED_RED: ReadonlyMap<string, RedPin> = new Map<
  string,
  RedPin
>([
  // F3: the membership drop now emits a plain REVOKE (no CASCADE). Tearing down
  // a multi-grantor membership where the removed grant has a dependent onward
  // grant fails LOUDLY on PG16+ ("dependent privileges exist") instead of
  // silently CASCADE-destroying the kept grant. Convergent regrant that would
  // let this teardown converge is tracked separately (#333); until it lands the
  // reverse (teardown) direction is expected-red ON PG16+ ONLY — pre-16 has no
  // dependent tracking, plain REVOKE succeeds, and the scenario passes.
  ["role-membership-dedup--multi-grantor:reverse", { minMajor: 16 }],
]);
