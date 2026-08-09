INSERT INTO test_schema.orders (id, status, customer_id, total_amount) VALUES (1, 'pending', 1, 100.00);
INSERT INTO test_schema.order_history (id, order_id, old_status, new_status) VALUES (1, 1, 'pending', 'processing');
