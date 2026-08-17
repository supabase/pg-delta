CREATE POLICY shop_customers_all ON shop.customers
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY shop_orders_own ON shop.orders
  FOR ALL USING (true) WITH CHECK (true);
