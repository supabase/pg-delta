CREATE VIEW shop.order_totals AS
SELECT o.id AS order_id,
       o.customer_id,
       sum(i.qty * i.unit_price_cents)::int AS total_cents
FROM shop.orders o
JOIN shop.order_items i ON i.order_id = o.id
GROUP BY o.id, o.customer_id;
