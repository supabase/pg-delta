CREATE SCHEMA s;
CREATE DOMAIN s.slug_text AS text CHECK (length(VALUE) > 0);
CREATE TABLE s.organizations (
  id uuid PRIMARY KEY,
  slug s.slug_text NOT NULL,
  slug_key text GENERATED ALWAYS AS (lower(slug::text)) STORED,
  CONSTRAINT organizations_slug_key UNIQUE (slug),
  CONSTRAINT organizations_slug_key_key UNIQUE (slug_key)
);
