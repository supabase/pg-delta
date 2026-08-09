CREATE SCHEMA test_schema;
CREATE TABLE test_schema.events (
  event_id integer NOT NULL,
  created_at timestamp NOT NULL,
  data jsonb,
  PRIMARY KEY (event_id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE test_schema.events_2024 PARTITION OF test_schema.events
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE test_schema.events_2025 PARTITION OF test_schema.events
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE INDEX idx_events_created ON test_schema.events (created_at);
CREATE FUNCTION test_schema.audit_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_events_audit
  AFTER INSERT OR UPDATE OR DELETE ON test_schema.events
  FOR EACH ROW
  EXECUTE FUNCTION test_schema.audit_event();
