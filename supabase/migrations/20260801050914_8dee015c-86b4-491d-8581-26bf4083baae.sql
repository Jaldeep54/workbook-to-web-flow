-- 1. shop_products ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, product_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_products TO authenticated;
GRANT ALL ON public.shop_products TO service_role;

ALTER TABLE public.shop_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_products_all_auth ON public.shop_products;
CREATE POLICY shop_products_all_auth ON public.shop_products
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS shop_products_shop_idx ON public.shop_products(shop_id);

-- backfill from historical orders
INSERT INTO public.shop_products (shop_id, product_id)
SELECT DISTINCT o.shop_id, ol.product_id
FROM public.order_lines ol
JOIN public.orders o ON o.id = ol.order_id
WHERE ol.qty > 0
ON CONFLICT DO NOTHING;

-- 2. orders: delivery date + status ---------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_date date;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Pending';

UPDATE public.orders SET delivery_date = order_date WHERE delivery_date IS NULL;
UPDATE public.orders o SET status = 'Delivered'
WHERE o.status <> 'Delivered'
  AND EXISTS (SELECT 1 FROM public.deliveries d WHERE d.order_id = o.id);

CREATE INDEX IF NOT EXISTS orders_delivery_date_idx ON public.orders(delivery_date);

-- 3. one payment per order ------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS payments_order_id_uniq ON public.payments(order_id);

-- 4. delivered <-> delivery/payment sync ---------------------------------
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
         COALESCE(SUM(ol.qty * p.label_cost_per_unit), 0),
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

CREATE OR REPLACE FUNCTION public.set_order_status(p_order_id uuid, p_status text, p_delivery_date date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_date date;
BEGIN
  IF p_status NOT IN ('Pending', 'Delivered', 'Cancelled') THEN
    RAISE EXCEPTION 'Invalid status %', p_status;
  END IF;

  IF p_status = 'Delivered' THEN
    SELECT COALESCE(p_delivery_date, delivery_date, order_date, CURRENT_DATE)
      INTO v_date FROM orders WHERE id = p_order_id;
    PERFORM set_order_delivered(p_order_id, v_date);
  ELSE
    DELETE FROM payments WHERE order_id = p_order_id AND status <> 'Received';
    DELETE FROM deliveries WHERE order_id = p_order_id
      AND NOT EXISTS (SELECT 1 FROM payments pm WHERE pm.order_id = p_order_id AND pm.status = 'Received');
    UPDATE orders SET status = p_status, updated_at = now() WHERE id = p_order_id;
  END IF;
END;
$$;

-- 5. label stock: only relevant products per shop -------------------------
DROP VIEW IF EXISTS public.shop_label_stock_summary;
DROP VIEW IF EXISTS public.label_stock_view;

CREATE VIEW public.label_stock_view AS
SELECT s.id AS shop_id,
       s.shop_name,
       s.design_type,
       lp.id AS label_product_id,
       lp.key AS label_product_key,
       lp.name AS label_product_name,
       lp.sort_order,
       lp.low_stock_threshold,
       (COALESCE(recv.received, 0::numeric) - COALESCE(used.used, 0::numeric)) AS stock,
       (COALESCE(recv.received, 0::numeric) - COALESCE(used.used, 0::numeric)) < lp.low_stock_threshold::numeric AS is_low,
       EXISTS (SELECT 1 FROM shop_products sp WHERE sp.shop_id = s.id AND sp.product_id = lp.product_id) AS shop_sells_product
  FROM shops s
  CROSS JOIN label_products lp
  LEFT JOIN LATERAL (
        SELECT sum(lol.products) AS received
          FROM label_order_lines lol
          JOIN label_orders lo ON lo.id = lol.label_order_id
         WHERE lo.shop_id = s.id AND lol.label_product_id = lp.id) recv ON true
  LEFT JOIN LATERAL (
        SELECT sum(ol.qty) AS used
          FROM order_lines ol
          JOIN orders o ON o.id = ol.order_id
         WHERE o.shop_id = s.id AND ol.product_id = lp.product_id) used ON true
 WHERE EXISTS (SELECT 1 FROM shop_products sp WHERE sp.shop_id = s.id AND sp.product_id = lp.product_id)
    OR COALESCE(recv.received, 0::numeric) - COALESCE(used.used, 0::numeric) <> 0;

GRANT SELECT ON public.label_stock_view TO authenticated;
GRANT SELECT ON public.label_stock_view TO service_role;

CREATE VIEW public.shop_label_stock_summary AS
SELECT shop_id,
       shop_name,
       design_type,
       count(*) FILTER (WHERE is_low) AS low_stock_count,
       EXISTS (SELECT 1 FROM label_orders lo WHERE lo.shop_id = v.shop_id) AS has_label_order,
       (count(*) FILTER (WHERE is_low) > 0)
         AND EXISTS (SELECT 1 FROM label_orders lo WHERE lo.shop_id = v.shop_id) AS include_in_dashboard
  FROM label_stock_view v
 GROUP BY shop_id, shop_name, design_type;

GRANT SELECT ON public.shop_label_stock_summary TO authenticated;
GRANT SELECT ON public.shop_label_stock_summary TO service_role;

-- 6. SKU opportunity ------------------------------------------------------
CREATE OR REPLACE VIEW public.shop_sku_opportunity AS
SELECT s.id AS shop_id,
       s.shop_name,
       s.label_name,
       s.address,
       s.is_active,
       COALESCE(act.keys, ARRAY[]::text[]) AS active_products,
       COALESCE(inact.keys, ARRAY[]::text[]) AS inactive_products,
       COALESCE(sales.avg_monthly_sales, 0)::numeric AS avg_monthly_sales,
       COALESCE(sales.total_sales, 0)::numeric AS total_sales,
       COALESCE(sales.months, 0)::integer AS active_months
  FROM shops s
  LEFT JOIN LATERAL (
        SELECT array_agg(p.short_name ORDER BY p.sort_order) AS keys
          FROM shop_products sp JOIN products p ON p.id = sp.product_id
         WHERE sp.shop_id = s.id) act ON true
  LEFT JOIN LATERAL (
        SELECT array_agg(p.short_name ORDER BY p.sort_order) AS keys
          FROM products p
         WHERE NOT EXISTS (SELECT 1 FROM shop_products sp WHERE sp.shop_id = s.id AND sp.product_id = p.id)) inact ON true
  LEFT JOIN LATERAL (
        SELECT SUM(d.total_sales) AS total_sales,
               COUNT(DISTINCT d.month) AS months,
               CASE WHEN COUNT(DISTINCT d.month) > 0
                    THEN SUM(d.total_sales) / COUNT(DISTINCT d.month) ELSE 0 END AS avg_monthly_sales
          FROM deliveries d WHERE d.shop_id = s.id) sales ON true;

GRANT SELECT ON public.shop_sku_opportunity TO authenticated;
GRANT SELECT ON public.shop_sku_opportunity TO service_role;

-- 7. lifetime ordered qty per product ------------------------------------
CREATE OR REPLACE FUNCTION public.order_qty_by_product()
RETURNS TABLE(product_id uuid, product_key text, short_name text, sort_order integer, total_qty numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.key, p.short_name, p.sort_order, COALESCE(SUM(ol.qty), 0)
    FROM products p
    LEFT JOIN order_lines ol ON ol.product_id = p.id
   GROUP BY p.id, p.key, p.short_name, p.sort_order
   ORDER BY p.sort_order;
$$;

-- 8. dashboard summary: received vs pending ------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_summary(p_month date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'month', p_month,
    'orderCount', (SELECT COUNT(*) FROM orders o WHERE o.month = p_month AND o.total_qty > 0),
    'orderQty', (SELECT COALESCE(SUM(o.total_qty), 0) FROM orders o WHERE o.month = p_month),
    'orderByProduct', (
      SELECT COALESCE(jsonb_object_agg(p.key, t.qty), '{}'::jsonb)
      FROM (
        SELECT ol.product_id, SUM(ol.qty) AS qty
        FROM order_lines ol JOIN orders o ON o.id = ol.order_id
        WHERE o.month = p_month GROUP BY ol.product_id
      ) t JOIN products p ON p.id = t.product_id
    ),
    'deliveryCount', (SELECT COUNT(*) FROM deliveries d WHERE d.month = p_month AND d.total_qty > 0),
    'deliveryQty', (SELECT COALESCE(SUM(d.total_qty), 0) FROM deliveries d WHERE d.month = p_month),
    'deliveryByProduct', (
      SELECT COALESCE(jsonb_object_agg(p.key, t.qty), '{}'::jsonb)
      FROM (
        SELECT dl.product_id, SUM(dl.qty) AS qty
        FROM delivery_lines dl JOIN deliveries d ON d.id = dl.delivery_id
        WHERE d.month = p_month GROUP BY dl.product_id
      ) t JOIN products p ON p.id = t.product_id
    ),
    'totalSales', (SELECT COALESCE(SUM(d.total_sales), 0) FROM deliveries d WHERE d.month = p_month),
    'totalFixedCost', (SELECT COALESCE(SUM(d.total_fixed_cost), 0) FROM deliveries d WHERE d.month = p_month),
    'paymentCount', (SELECT COUNT(*) FROM payments pm WHERE pm.month = p_month AND pm.status = 'Received' AND pm.amount > 0),
    'paymentsReceived', (SELECT COALESCE(SUM(pm.amount), 0) FROM payments pm WHERE pm.month = p_month AND pm.status = 'Received'),
    'paymentsPending', (SELECT COALESCE(SUM(pm.amount), 0) FROM payments pm WHERE pm.month = p_month AND pm.status <> 'Received'),
    'variableCost', (SELECT COALESCE(SUM(vc.amount), 0) FROM variable_costs vc WHERE vc.month = p_month),
    'labelOrderCount', (SELECT COUNT(*) FROM label_orders lo WHERE lo.month = p_month AND lo.total_labels > 0),
    'labelByProduct', (
      SELECT COALESCE(jsonb_object_agg(lp.key, t.qty), '{}'::jsonb)
      FROM (
        SELECT lol.label_product_id, SUM(lol.products) AS qty
        FROM label_order_lines lol JOIN label_orders lo ON lo.id = lol.label_order_id
        WHERE lo.month = p_month GROUP BY lol.label_product_id
      ) t JOIN label_products lp ON lp.id = t.label_product_id
    ),
    'totalLabels', (
      SELECT COALESCE(SUM(lo.total_labels), 0) FROM label_orders lo WHERE lo.month = p_month
    )
  );
$function$;

-- 9. next shop code -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_shop_code()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT GREATEST(
    (SELECT COUNT(*) FROM shops),
    COALESCE((SELECT MAX(NULLIF(regexp_replace(code, '\D', '', 'g'), '')::bigint) FROM shops), 0)
  )::integer + 1;
$$;