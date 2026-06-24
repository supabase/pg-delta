CREATE VIEW test_schema.active_users AS SELECT id,
    name,
    email
   FROM test_schema.users
  WHERE (email IS NOT NULL)