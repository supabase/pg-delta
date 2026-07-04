# Roadmap

The forward-looking plan: cut **v1 on correctness**, then performance, then DX
and cutover.

## What's here

- **[v1.md](v1.md)** — the one-page v1 plan: what's already done and proven, and
  what blocks a correctness-first cut.
- **[v1-evidence.md](v1-evidence.md)** — the reproducible evidence record to fill
  when the v1 validation gates are run at scale (template; v1 isn't cut until it's
  filled).
- **[post-v1.md](post-v1.md)** — the consolidated backlog after v1: the
  performance milestone, the DX & cutover milestone, and the deliberate deferrals.
- **[extension-intent-phase-b.md](extension-intent-phase-b.md)** — full design for
  replaying stateful-extension intent on a from-scratch rebuild (blocked on a
  format decision).
- **[ephemeral-shadow-design.md](ephemeral-shadow-design.md)** — full design for
  auto-provisioning an ephemeral shadow database (deferred).
- **[pg-delta-next-follow-ups.md](pg-delta-next-follow-ups.md)** — known pitfalls
  and follow-ups captured from the PR #315 review, ranked P1–P3.

## How the engine got here

For the build stages, hardening, review passes, and shipped work, see
[../build-log.md](../build-log.md).

## Conventions

- Code citations are workspace-relative (`packages/pg-delta-next/src/...`).
- Linear IDs map to the *pg-delta: database diffing 2.0* project.
- Every planned change follows **Test-Driven Fixes**: author the RED test before
  the production change.
