INSERT INTO test_schema.bookings
  VALUES (1, '[2025-01-01,2025-01-02)'::tstzrange);
INSERT INTO test_schema.booking_audit
  VALUES (1, '[2025-01-01,2025-01-02)'::tstzrange);
