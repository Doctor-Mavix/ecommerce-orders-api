-- Invariants the application must never be able to break, written where they cannot be
-- bypassed. Prisma's schema language has no syntax for CHECK constraints, so this migration
-- is hand-written; `prisma migrate` applies and tracks it like any other.
--
-- The service checks stock before it sells, but a check followed by a write is two steps, and
-- two concurrent checkouts can both pass the first one. The constraint is what turns that race
-- into a failed transaction instead of a negative stock.

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_stock_non_negative" CHECK ("stock" >= 0);

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_price_non_negative" CHECK ("price_cents" >= 0);

ALTER TABLE "products"
  ADD CONSTRAINT "products_base_price_non_negative" CHECK ("base_price_cents" >= 0);

-- A line with a quantity of zero is not an empty line, it is a bug that would make a total
-- disagree with what it is made of.
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);

-- The invoice has to add up. Recomputing a total from its lines is cheap; discovering months
-- later that some of them never did is not.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_line_total_matches"
  CHECK ("line_total_cents" = "unit_price_cents" * "quantity");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_matches"
  CHECK ("total_cents" = "subtotal_cents" + "shipping_cents");
