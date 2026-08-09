-- plain integer column that gains identity AND widens to bigint in one plan
CREATE SCHEMA app;

-- NOT NULL is deliberate on this plain side: identity columns are implicitly
-- NOT NULL, so declaring it here makes both sides agree and keeps the
-- pre-existing `identity`-before-`notNull` ordering gap (alphabetical emission
-- puts ADD … AS IDENTITY before SET NOT NULL) out of this scenario. The point
-- here is the DROP DEFAULT bookend of the `type` change: ADD IDENTITY orders
-- before the type delta, so DROP DEFAULT must be gated on the DESIRED-side
-- identity, not the source one.
CREATE TABLE app.counters (
  id integer NOT NULL,
  label text
);
