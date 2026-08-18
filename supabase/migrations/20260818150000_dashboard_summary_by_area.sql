-- dashboard_summary_by_area: sibling to dashboard_summary(), adding an
-- optional shop-area dimension so the Overview page's stat cards and charts
-- can be scoped to one Shop Area (p_area_id NULL = whole business, same as
-- dashboard_summary). Follows the same shops.area_id -> shop_areas join
-- pattern the shop_analysis migration uses to scope deliveries/delivery_lines
-- to an area's shops, just aggregated across the whole area instead of one
-- shop.
--
-- Adds three area-scoped extras dashboard_summary doesn't have:
--   monthlySales - total delivered sales per month for the last 3 months
--                  (same "last N months including the current one" window
--                  convention as SHOP_ANALYSIS_MONTHS/shop_analysis(), here
--                  anchored on p_month rather than CURRENT_DATE since this
--                  page's month is a user-selectable parameter).
--   productMix   - each product's share of the selected month's total sales
--                  (revenue = delivery_lines.qty x products.selling_price),
--                  the same computation as shop_analysis()'s productMix/
--                  monthlySales.byProduct, aggregated over the area.
--   topShops     - the area's top 5 shops by the selected month's delivered
--                  sales (or the whole business's top 5 when no area is
--                  selected).
--
-- variable_costs has no shop/area dimension in the schema at all (it's a
-- business-wide register — transportation, salaries, etc.) so 'variableCost'
-- below is always the whole business's figure, unaffected by p_area_id.
CREATE OR REPLACE FUNCTION public.dashboard_summary_by_area(p_month date, p_area_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH bounds AS (
    SELECT (date_trunc('month', p_month) - interval '2 months')::date AS window_start,
           (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date AS window_end
  ),
  months AS (
    SELECT generate_series(window_start, window_end, interval '1 month')::date AS month FROM bounds
  ),
  monthly_sales AS (
    SELECT d.month, SUM(d.total_sales) AS sales
      FROM deliveries d JOIN shops s ON s.id = d.shop_id, bounds b
     WHERE d.month BETWEEN b.window_start AND b.window_end
       AND (p_area_id IS NULL OR s.area_id = p_area_id)
     GROUP BY d.month
  ),
  product_amounts AS (
    SELECT dl.product_id, SUM(dl.qty * pr.selling_price) AS amount
      FROM delivery_lines dl
      JOIN deliveries d ON d.id = dl.delivery_id
      JOIN shops s ON s.id = d.shop_id
      JOIN products pr ON pr.id = dl.product_id
     WHERE d.month = p_month AND (p_area_id IS NULL OR s.area_id = p_area_id)
     GROUP BY dl.product_id
  ),
  product_total AS (
    SELECT COALESCE(SUM(amount), 0) AS total FROM product_amounts
  ),
  top_shops AS (
    SELECT s.id AS shop_id, s.shop_name, SUM(d.total_sales) AS sales
      FROM deliveries d JOIN shops s ON s.id = d.shop_id
     WHERE d.month = p_month AND (p_area_id IS NULL OR s.area_id = p_area_id)
     GROUP BY s.id, s.shop_name
     ORDER BY sales DESC
     LIMIT 5
  )
  SELECT jsonb_build_object(
    'month', p_month,
    'areaId', p_area_id,
    'orderCount', (
      SELECT COUNT(*) FROM orders o JOIN shops s ON s.id = o.shop_id
       WHERE o.month = p_month AND o.total_qty > 0 AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'orderQty', (
      SELECT COALESCE(SUM(o.total_qty), 0) FROM orders o JOIN shops s ON s.id = o.shop_id
       WHERE o.month = p_month AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'orderByProduct', (
      SELECT COALESCE(jsonb_object_agg(p.key, t.qty), '{}'::jsonb)
      FROM (
        SELECT ol.product_id, SUM(ol.qty) AS qty
          FROM order_lines ol JOIN orders o ON o.id = ol.order_id JOIN shops s ON s.id = o.shop_id
         WHERE o.month = p_month AND (p_area_id IS NULL OR s.area_id = p_area_id)
         GROUP BY ol.product_id
      ) t JOIN products p ON p.id = t.product_id
    ),
    'deliveryCount', (
      SELECT COUNT(*) FROM deliveries d JOIN shops s ON s.id = d.shop_id
       WHERE d.month = p_month AND d.total_qty > 0 AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'deliveryQty', (
      SELECT COALESCE(SUM(d.total_qty), 0) FROM deliveries d JOIN shops s ON s.id = d.shop_id
       WHERE d.month = p_month AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'deliveryByProduct', (
      SELECT COALESCE(jsonb_object_agg(p.key, t.qty), '{}'::jsonb)
      FROM (
        SELECT dl.product_id, SUM(dl.qty) AS qty
          FROM delivery_lines dl JOIN deliveries d ON d.id = dl.delivery_id JOIN shops s ON s.id = d.shop_id
         WHERE d.month = p_month AND (p_area_id IS NULL OR s.area_id = p_area_id)
         GROUP BY dl.product_id
      ) t JOIN products p ON p.id = t.product_id
    ),
    'totalSales', (
      SELECT COALESCE(SUM(d.total_sales), 0) FROM deliveries d JOIN shops s ON s.id = d.shop_id
       WHERE d.month = p_month AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'totalFixedCost', (
      SELECT COALESCE(SUM(d.total_fixed_cost), 0) FROM deliveries d JOIN shops s ON s.id = d.shop_id
       WHERE d.month = p_month AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'paymentCount', (
      SELECT COUNT(*) FROM payments pm JOIN shops s ON s.id = pm.shop_id
       WHERE pm.month = p_month AND pm.status = 'Received' AND pm.amount > 0
         AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'paymentsReceived', (
      SELECT COALESCE(SUM(pm.amount), 0) FROM payments pm JOIN shops s ON s.id = pm.shop_id
       WHERE pm.month = p_month AND pm.status = 'Received' AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'paymentsPending', (
      SELECT COALESCE(SUM(pm.amount), 0) FROM payments pm JOIN shops s ON s.id = pm.shop_id
       WHERE pm.month = p_month AND pm.status <> 'Received' AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'variableCost', (SELECT COALESCE(SUM(vc.amount), 0) FROM variable_costs vc WHERE vc.month = p_month),
    'labelOrderCount', (
      SELECT COUNT(*) FROM label_orders lo JOIN shops s ON s.id = lo.shop_id
       WHERE lo.month = p_month AND lo.total_labels > 0 AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'labelByProduct', (
      SELECT COALESCE(jsonb_object_agg(lp.key, t.qty), '{}'::jsonb)
      FROM (
        SELECT lol.label_product_id, SUM(lol.products) AS qty
          FROM label_order_lines lol
          JOIN label_orders lo ON lo.id = lol.label_order_id
          JOIN shops s ON s.id = lo.shop_id
         WHERE lo.month = p_month AND (p_area_id IS NULL OR s.area_id = p_area_id)
         GROUP BY lol.label_product_id
      ) t JOIN label_products lp ON lp.id = t.label_product_id
    ),
    'totalLabels', (
      SELECT COALESCE(SUM(lo.total_labels), 0) FROM label_orders lo JOIN shops s ON s.id = lo.shop_id
       WHERE lo.month = p_month AND (p_area_id IS NULL OR s.area_id = p_area_id)
    ),
    'monthlySales', (
      SELECT COALESCE(jsonb_agg(
               jsonb_build_object('month', m.month, 'totalSales', COALESCE(ms.sales, 0)) ORDER BY m.month
             ), '[]'::jsonb)
        FROM months m LEFT JOIN monthly_sales ms ON ms.month = m.month
    ),
    'productMix', (
      SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                 'productId', p.id, 'shortName', p.short_name, 'sortOrder', p.sort_order,
                 'amount', pa.amount,
                 'sharePct', CASE WHEN pt.total > 0 THEN ROUND(pa.amount / pt.total * 100, 2) ELSE 0 END
               ) ORDER BY p.sort_order
             ), '[]'::jsonb)
        FROM product_amounts pa
        JOIN products p ON p.id = pa.product_id
        CROSS JOIN product_total pt
    ),
    'topShops', (
      SELECT COALESCE(jsonb_agg(
               jsonb_build_object('shopId', shop_id, 'shopName', shop_name, 'sales', sales) ORDER BY sales DESC
             ), '[]'::jsonb)
        FROM top_shops
    )
  );
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_summary_by_area(date, uuid) TO authenticated;
