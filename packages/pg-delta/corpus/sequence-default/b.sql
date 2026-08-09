CREATE SEQUENCE public.order_seq START 1000 INCREMENT 10;
CREATE TABLE public.orders (
  id bigint DEFAULT nextval('public.order_seq') PRIMARY KEY,
  note text
);
