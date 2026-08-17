ALTER TABLE gi_items
  ADD COLUMN total_cents int GENERATED ALWAYS AS (qty * unit_cents) STORED;
