-- seed data: orders.amount contains numeric strings castable to integer
INSERT INTO test_schema.orders (id, amount) VALUES (1, '42'), (2, '100');
INSERT INTO test_schema.priced (id) VALUES (1);
