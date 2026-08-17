CREATE INDEX shop_products_category_idx ON shop.products (category_id);
CREATE INDEX shop_orders_customer_idx ON shop.orders (customer_id);
CREATE INDEX shop_products_attrs_gin ON shop.products USING gin (attrs);
