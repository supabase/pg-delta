CREATE MATERIALIZED VIEW mv_sales_sum AS
SELECT sku, sum(qty)::int AS qty FROM mv_sales GROUP BY sku
WITH DATA;
