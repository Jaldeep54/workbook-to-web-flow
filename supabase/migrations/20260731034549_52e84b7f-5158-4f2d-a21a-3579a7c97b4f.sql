-- Per shop / per label product stock, mirroring the workbook's stock formula
CREATE VIEW public.label_stock_view
WITH (security_invoker = true) AS
SELECT
  s.id AS shop_id,
  s.shop_name,
  s.design_type,
  lp.id AS label_product_id,
  lp.key AS label_product_key,
  lp.name AS label_product_name,
  lp.sort_order,
  lp.low_stock_threshold,
  COALESCE(recv.received, 0) - COALESCE(used.used, 0) AS stock,
  (COALESCE(recv.received, 0) - COALESCE(used.used, 0)) < lp.low_stock_threshold AS is_low
FROM public.shops s
CROSS JOIN public.label_products lp
LEFT JOIN LATERAL (
  SELECT SUM(lol.products) AS received
  FROM public.label_order_lines lol
  JOIN public.label_orders lo ON lo.id = lol.label_order_id
  WHERE lo.shop_id = s.id AND lol.label_product_id = lp.id
) recv ON true
LEFT JOIN LATERAL (
  SELECT SUM(ol.qty) AS used
  FROM public.order_lines ol
  JOIN public.orders o ON o.id = ol.order_id
  WHERE o.shop_id = s.id AND ol.product_id = lp.product_id
) used ON true;

GRANT SELECT ON public.label_stock_view TO authenticated;
GRANT SELECT ON public.label_stock_view TO service_role;

CREATE VIEW public.shop_label_stock_summary
WITH (security_invoker = true) AS
SELECT
  v.shop_id,
  v.shop_name,
  v.design_type,
  COUNT(*) FILTER (WHERE v.is_low) AS low_stock_count,
  EXISTS (SELECT 1 FROM public.label_orders lo WHERE lo.shop_id = v.shop_id) AS has_label_order,
  (COUNT(*) FILTER (WHERE v.is_low) > 0
    AND EXISTS (SELECT 1 FROM public.label_orders lo WHERE lo.shop_id = v.shop_id)) AS include_in_dashboard
FROM public.label_stock_view v
GROUP BY v.shop_id, v.shop_name, v.design_type;

GRANT SELECT ON public.shop_label_stock_summary TO authenticated;
GRANT SELECT ON public.shop_label_stock_summary TO service_role;

-- Monthly KPI summary
CREATE OR REPLACE FUNCTION public.dashboard_summary(p_month date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    'paymentCount', (SELECT COUNT(*) FROM payments pm WHERE pm.month = p_month AND pm.amount > 0),
    'paymentsReceived', (SELECT COALESCE(SUM(pm.amount), 0) FROM payments pm WHERE pm.month = p_month),
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
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_summary(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.available_months()
RETURNS TABLE (month date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT m FROM (
    SELECT month AS m FROM orders WHERE month IS NOT NULL
    UNION ALL SELECT month FROM deliveries WHERE month IS NOT NULL
    UNION ALL SELECT month FROM payments WHERE month IS NOT NULL
    UNION ALL SELECT month FROM label_orders WHERE month IS NOT NULL
    UNION ALL SELECT month FROM variable_costs WHERE month IS NOT NULL
  ) x ORDER BY m DESC;
$$;

GRANT EXECUTE ON FUNCTION public.available_months() TO authenticated;