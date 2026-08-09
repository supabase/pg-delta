CREATE SCHEMA test_schema;

CREATE TABLE test_schema.transactions (
  id bigserial PRIMARY KEY,
  amount numeric(10,2),
  status text
);

-- Function returning SETOF the table
CREATE FUNCTION test_schema.get_transactions_by_status(search_status text)
RETURNS SETOF test_schema.transactions
LANGUAGE sql
STABLE
AS $function$
  SELECT * FROM test_schema.transactions WHERE status = search_status
$function$;

-- Materialized view also depending on the table
CREATE MATERIALIZED VIEW test_schema.transaction_summary AS
SELECT status, count(*) AS count, sum(amount) AS total
FROM test_schema.transactions
GROUP BY status;
