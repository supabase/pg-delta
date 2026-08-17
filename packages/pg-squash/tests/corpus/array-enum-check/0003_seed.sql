INSERT INTO aec_flags VALUES
  (1, 'red', ARRAY['hot','new']),
  (2, 'blue', ARRAY['cool']);
ALTER TABLE aec_flags ADD CONSTRAINT aec_flags_tags_len CHECK (cardinality(tags) < 8);
