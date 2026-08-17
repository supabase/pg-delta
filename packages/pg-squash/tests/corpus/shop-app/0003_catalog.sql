CREATE TABLE shop.categories (
  id int PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL
);
CREATE TABLE shop.products (
  id int PRIMARY KEY,
  category_id int NOT NULL REFERENCES shop.categories (id),
  sku text NOT NULL UNIQUE,
  title text NOT NULL,
  price_cents int NOT NULL CHECK (price_cents >= 0),
  attrs jsonb NOT NULL DEFAULT '{}'::jsonb
);
