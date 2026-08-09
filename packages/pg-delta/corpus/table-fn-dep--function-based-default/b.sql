CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.serial_counter()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $function$
BEGIN
  RETURN nextval('test_schema.counter_seq'::regclass);
END;
$function$;

CREATE SEQUENCE test_schema.counter_seq;

CREATE TABLE test_schema.event_log (
  id integer PRIMARY KEY DEFAULT test_schema.serial_counter(),
  message text
);
