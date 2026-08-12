---
"@supabase/pg-delta": minor
---

feat: opt-in bounded-parallel extraction via `ExtractOptions.concurrency`.

`extract(pool, { concurrency: 4 })` now exports the coordinator's snapshot with
`pg_export_snapshot()` and fans the catalog families out over that many
connections from the same pool, all importing that snapshot — so the capture is
still one consistent moment in database time. It exists for high-latency links,
where serial extraction is dominated by its sequential catalog round trips rather
than by work (see the batched-catalog changeset for the current count).

The output is byte-identical to a serial extraction — same facts, same edge
order, same diagnostics order, same fact-base fingerprint — because per-family
results are slotted by family index and merged in the fixed call order, never in
completion order. Default (`1` / unset) keeps the serial, single-connection
capture.

Requesting more streams than the pool's `max` clamps to it (the coordinator holds
a client for the whole extraction, so over-requesting would deadlock on
`connect()`), with a hard cap of 8. If the snapshot cannot be shared — a standby,
a pooler that blocks `SET TRANSACTION SNAPSHOT`, a `max: 1` pool — extraction
degrades silently to serial with no extra diagnostic.
