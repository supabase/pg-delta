-- seed data: orders.amount is already integer; priced uses its numeric(12,4) default
INSERT INTO test_schema.orders (id, amount) VALUES (1, 42), (2, 100);
INSERT INTO test_schema.priced (id) VALUES (1);
