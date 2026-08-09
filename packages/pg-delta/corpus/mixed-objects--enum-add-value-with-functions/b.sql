CREATE SCHEMA test_schema;

-- Enum with additional values (delivered, cancelled, returned added)
CREATE TYPE test_schema.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned');

CREATE TABLE test_schema.orders (
  id integer PRIMARY KEY,
  status test_schema.order_status DEFAULT 'pending',
  customer_id integer,
  total_amount numeric(10,2)
);

CREATE TABLE test_schema.order_history (
  id integer PRIMARY KEY,
  order_id integer,
  old_status test_schema.order_status,
  new_status test_schema.order_status,
  changed_at timestamp DEFAULT now()
);

CREATE OR REPLACE FUNCTION test_schema.get_orders_by_status(status_filter test_schema.order_status)
 RETURNS TABLE(order_id integer, customer_id integer, total_amount numeric)
 LANGUAGE plpgsql
AS $function$
begin
    return query
    select o.id, o.customer_id, o.total_amount
    from test_schema.orders o
    where o.status = status_filter;
end;
$function$;
