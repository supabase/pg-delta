# Roadmap

The forward-looking plan: finish the validation gates at scale, then
performance, then DX.

## What's here

- **[backlog.md](backlog.md)** — the single consolidated backlog: the remaining
  validation gates, the performance milestone, the DX milestone, the parked
  architecture tracks, and the deliberate deferrals.
- **[pg-delta-next-follow-ups.md](pg-delta-next-follow-ups.md)** — known pitfalls
  and per-PR review triage, ranked P1–P3. This is the live correctness ledger:
  anything deliberately deferred from a review lands here rather than being
  silently dropped (including the 2026-08 old-engine differential-review /
  cutover triage).
- **[extension-intent-phase-b.md](extension-intent-phase-b.md)** — full design for
  replaying stateful-extension intent on a from-scratch rebuild (blocked on a
  format decision).
- **[ephemeral-shadow-design.md](ephemeral-shadow-design.md)** — full design for
  auto-provisioning an ephemeral shadow database (deferred).
- **[schema-first-cli-enablement.md](schema-first-cli-enablement.md)** — what
  pg-delta exports so the Supabase CLI can build the schema-first workflow
  (`schema pull / diff / generate / apply / push`). V1 work packages have
  shipped (#414, #416, #418–#421, #423); remaining items are WP5 (not V1)
  and WP6 (deferred).
- **[pg-squash-design.md](pg-squash-design.md)** — standalone `@supabase/pg-squash`
  package: compress a migration chain into the minimum number of transactions
  with a proof of equivalence. Design approved; implementation not started.

## How the engine got here

For the build stages, hardening, review passes, and shipped work, see
[../build-log.md](../build-log.md).

## Conventions

- Code citations are workspace-relative (`packages/pg-delta/src/...`).
- Linear IDs map to the *pg-delta: database diffing 2.0* project.
- Every planned change follows **Test-Driven Fixes**: author the RED test before
  the production change.
