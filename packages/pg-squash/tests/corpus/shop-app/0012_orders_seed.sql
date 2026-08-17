INSERT INTO shop.orders (id, customer_id, status) VALUES (10, 1, 'paid');
INSERT INTO shop.order_items (order_id, product_id, qty, unit_price_cents)
VALUES (10, 1, 2, 1200), (10, 2, 1, 400);
