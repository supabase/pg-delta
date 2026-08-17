CREATE INDEX shop_orders_pending_idx ON shop.orders (placed_at)
  WHERE status = 'pending';
