CREATE SCHEMA test_schema;

CREATE TABLE test_schema.complex_table (
  id uuid,
  metadata jsonb,
  tags text[],
  coordinates point,
  price numeric(10,2),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
