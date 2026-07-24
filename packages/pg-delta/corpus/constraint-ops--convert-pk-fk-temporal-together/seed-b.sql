INSERT INTO test_schema.contacts
  VALUES (1, '[2025-01-01,2025-01-02)'::tstzrange);
INSERT INTO test_schema.conversations
  VALUES (1, 1, '[2025-01-01,2025-01-02)'::tstzrange);
