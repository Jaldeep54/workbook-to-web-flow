-- Labelling cost must come from the label records (Rates & Settings → Label rates),
-- summed across every label_products row for a product, not a single manually-entered
-- figure. This previously undercounted products with more than one label component
-- (e.g. Laundry Liquid 700's separate Front/Back labels only counted the Front label).
--
-- public.compute_product_label_cost() is the single formula for "Label / unit":
--   SUM(sheet_cost / labels_per_sheet) over every label_products row for that product.
--
-- products.label_cost_per_unit is kept as a column (rather than dropped) purely for
-- compatibility with existing reads (the frontend's cached `products` query, CSV/report
-- code, Supabase Studio) so they don't all need a second join/query against
-- label_products just to display a rate. It is no longer user-editable and is kept in
-- sync automatically by the trigger below whenever label_products changes — it is never
-- the authoritative calculation itself. The one place that computes labelling cost
-- server-side, set_order_delivered(), calls compute_product_label_cost() directly and
-- does not depend on this cached column at all.

CREATE OR REPLACE FUNCTION public.compute_product_label_cost(p_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(lp.sheet_cost / NULLIF(lp.labels_per_sheet, 0)), 0)
    FROM label_products lp
   WHERE lp.product_id = p_product_id;
$$;

-- Keeps products.label_cost_per_unit (the compatibility cache) equal to
-- compute_product_label_cost() for the affected product(s), whenever a label is added,
-- removed, re-priced, or reassigned to a different product.
CREATE OR REPLACE FUNCTION public.sync_product_label_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE products SET label_cost_per_unit = compute_product_label_cost(OLD.product_id)
     WHERE id = OLD.product_id;
    RETURN OLD;
  END IF;

  UPDATE products SET label_cost_per_unit = compute_product_label_cost(NEW.product_id)
   WHERE id = NEW.product_id;

  IF TG_OP = 'UPDATE' AND OLD.product_id IS DISTINCT FROM NEW.product_id THEN
    UPDATE products SET label_cost_per_unit = compute_product_label_cost(OLD.product_id)
     WHERE id = OLD.product_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS label_products_sync_label_cost ON public.label_products;
CREATE TRIGGER label_products_sync_label_cost
AFTER INSERT OR UPDATE OR DELETE ON public.label_products
FOR EACH ROW EXECUTE FUNCTION public.sync_product_label_cost();

-- Backfill every product's cached rate right now (fixes Laundry Liquid 700 from 5.5,
-- which only ever reflected the Front label, to 22/4 + 16/12 = 6.833333).
UPDATE public.products p SET label_cost_per_unit = public.compute_product_label_cost(p.id);

-- set_order_delivered() must use the same live aggregate, not the cached column, when it
-- freezes a delivery's cost figures.
CREATE OR REPLACE FUNCTION public.set_order_delivered(p_order_id uuid, p_delivery_date date)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_delivery_id uuid;
  v_shop uuid;
  v_qty numeric := 0;
  v_sales numeric := 0;
  v_lab numeric := 0;
  v_pack numeric := 0;
  v_prod numeric := 0;
  v_fixed numeric := 0;
BEGIN
  SELECT shop_id INTO v_shop FROM orders WHERE id = p_order_id;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT COALESCE(SUM(ol.qty), 0),
         COALESCE(SUM(ol.qty * p.selling_price), 0),
         COALESCE(SUM(ol.qty * compute_product_label_cost(p.id)), 0),
         COALESCE(SUM(ol.qty * p.packaging_cost), 0),
         COALESCE(SUM(ol.qty * p.production_cost), 0)
    INTO v_qty, v_sales, v_lab, v_pack, v_prod
    FROM order_lines ol
    JOIN products p ON p.id = ol.product_id
   WHERE ol.order_id = p_order_id;

  v_fixed := v_prod + v_pack + v_lab;

  SELECT id INTO v_delivery_id FROM deliveries WHERE order_id = p_order_id LIMIT 1;

  IF v_delivery_id IS NULL THEN
    INSERT INTO deliveries (shop_id, order_id, delivery_date, status, total_qty, total_sales,
                            labelling_cost, packaging_cost, production_cost, total_fixed_cost, profit)
    VALUES (v_shop, p_order_id, p_delivery_date, 'Delivered', v_qty, v_sales,
            v_lab, v_pack, v_prod, v_fixed, v_sales - v_fixed)
    RETURNING id INTO v_delivery_id;
  ELSE
    UPDATE deliveries
       SET delivery_date = p_delivery_date, status = 'Delivered', total_qty = v_qty,
           total_sales = v_sales, labelling_cost = v_lab, packaging_cost = v_pack,
           production_cost = v_prod, total_fixed_cost = v_fixed, profit = v_sales - v_fixed,
           updated_at = now()
     WHERE id = v_delivery_id;
    DELETE FROM delivery_lines WHERE delivery_id = v_delivery_id;
  END IF;

  INSERT INTO delivery_lines (delivery_id, product_id, qty)
  SELECT v_delivery_id, ol.product_id, ol.qty
    FROM order_lines ol
   WHERE ol.order_id = p_order_id AND ol.qty > 0;

  INSERT INTO payments (shop_id, order_id, payment_date, status, amount)
  VALUES (v_shop, p_order_id, p_delivery_date, 'Pending', v_sales)
  ON CONFLICT (order_id) DO UPDATE
    SET amount = CASE WHEN payments.status = 'Received' THEN payments.amount ELSE EXCLUDED.amount END,
        updated_at = now();

  UPDATE orders SET status = 'Delivered', delivery_date = p_delivery_date, updated_at = now()
   WHERE id = p_order_id;

  RETURN v_delivery_id;
END;
$$;
