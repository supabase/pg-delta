INSERT INTO shop.customers (email, name) VALUES
  ('ada@example.com', 'Ada'),
  ('bob@example.com', 'Bob');
INSERT INTO shop.categories (id, slug, title) VALUES
  (1, 'mugs', 'Mugs'),
  (2, 'pins', 'Pins');
INSERT INTO shop.products (id, category_id, sku, title, price_cents, attrs) VALUES
  (1, 1, 'MUG-1', 'Blue mug', 1200, '{"color":"blue"}'),
  (2, 2, 'PIN-1', 'Gold pin', 400, '{"finish":"gold"}');
