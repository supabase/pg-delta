CREATE TRIGGER shop_products_audit
AFTER INSERT OR UPDATE ON shop.products
FOR EACH ROW EXECUTE FUNCTION shop.audit_product();
