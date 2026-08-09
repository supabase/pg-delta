---
"@supabase/pg-delta": patch
---

Speed up planning on very large catalogs by computing the managed-view projection once per plan and removing several superlinear hot spots.

`plan()` reconstructed the managed view of both sides twice — once to build the change set, once again to attribute the projection audit — and the audit then ran a third full diff even when nothing had been suppressed. The change set now collects projection suppressions as it reconstructs, the audit is attributed from those records, and it short-circuits when the projection hid nothing. `resolveView` also returns the input by reference immediately when there is no policy, capability or baseline and no extension-member/managed-by provenance, instead of proving that with three full passes over the fact base.

Four scaling fixes on top: the action graph's teardown ordering uses the fact base's reverse edge index instead of rescanning every edge per destroyed id; the projected-target orphan sweep is a reverse-BFS from the removed set instead of a whole-base rescan per fixpoint round; the delta sort computes each sort key once instead of once per comparison; and the projection removal walk memoizes negative answers, so a deep hierarchy no longer re-walks and re-encodes every ancestor chain.

No behavior change — the deltas, plan actions and SQL are byte-identical. On a 433k-fact catalog the cold plan drops 2.6s → 1.4s; on the 180k-fact stress fixture the plan phase drops 627ms → 226ms.
