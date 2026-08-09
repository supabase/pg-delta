-- state B: temporal PK (WITHOUT OVERLAPS) + temporal FK (PERIOD). The #182
-- silent-downgrade regression: converting both together must NOT lose the
-- temporal-ness in either direction.
CREATE EXTENSION btree_gist;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.contacts (
  contact_id integer NOT NULL,
  valid_period tstzrange NOT NULL,
  CONSTRAINT contacts_pkey PRIMARY KEY (contact_id, valid_period WITHOUT OVERLAPS)
);
CREATE TABLE test_schema.conversations (
  conversation_id integer NOT NULL,
  contact_id integer NOT NULL,
  valid_period tstzrange NOT NULL,
  CONSTRAINT conversations_pkey PRIMARY KEY (conversation_id),
  CONSTRAINT conversations_contact_fkey
    FOREIGN KEY (contact_id, PERIOD valid_period)
    REFERENCES test_schema.contacts (contact_id, PERIOD valid_period)
);
