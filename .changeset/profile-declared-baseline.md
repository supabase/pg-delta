---
"@supabase/pg-delta": minor
---

A custom `--profile` file can now declare its own baseline: `{ "id": …, "handlers": […], "baseline": "./middleware-base.json" }`. The baseline (a `pgdelta snapshot` file, path resolved relative to the profile file) is subtracted from both sides by the commands that resolve the profile for diffing — `plan`, `diff`, `schema export`, `schema apply`, `apply`, `prove` — so platform-provided objects captured in it (base-image roles, extension-owned schemas) stay invisible to the managed view without a policy or a per-command flag. `diff` and `drift` gained `--profile` for parity (handler-aware extraction).

Because the baseline travels with the profile, `plan == prove == apply` holds by construction. The baseline's digest is stamped on the plan artifact and the export manifest, and reconciled at `apply` / `prove` / `schema apply` time: a swapped, edited, or missing baseline now fails loud with a precise message instead of an opaque fingerprint-gate rejection (or, previously, silent divergence — `prove` never received a baseline at all). A baseline captured in a different secret-redaction mode than the command's extraction is also rejected, since mismatched redaction would silently stop the baseline subtracting. `pgdelta snapshot` gained `--profile` so a baseline snapshot captures the same handler-aware facts (extension-intent rows, managed-object edges) the profile's other commands extract; `snapshot` and `drift` deliberately do NOT load the profile's declared baseline (a `snapshot` typically CAPTURES that very file, and `drift` is a raw snapshot-vs-live comparison), so a not-yet-existent declared baseline never blocks them.

This replaces the experimental `--baseline` CLI flag (never released) with the profile-declared form.
