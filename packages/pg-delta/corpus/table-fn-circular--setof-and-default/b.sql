CREATE SCHEMA test_schema;

-- Function used as DEFAULT in table below (table depends on function)
CREATE FUNCTION test_schema.next_order_number()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $function$
BEGIN
  RETURN (SELECT coalesce(max(order_number), 0) + 1 FROM test_schema.orders);
END;
$function$;

-- Table using function as default (depends on function above)
CREATE TABLE test_schema.orders (
  id bigserial PRIMARY KEY,
  order_number integer DEFAULT test_schema.next_order_number(),
  total_amount numeric(10,2),
  created_at timestamp DEFAULT now()
);

-- Function returning SETOF the table (depends on table above)
CREATE FUNCTION test_schema.get_recent_orders()
RETURNS SETOF test_schema.orders
LANGUAGE sql
STABLE
AS $function$
  SELECT * FROM test_schema.orders
  WHERE created_at > now() - interval '7 days'
  ORDER BY created_at DESC
$function$;
