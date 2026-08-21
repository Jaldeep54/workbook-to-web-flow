-- Shop Analysis: one RPC computing everything the "Shop Analysis" tab and the
-- "Shop Sales Indicator" (in the New Order form) need, so both consumers read
-- exactly the same numbers (single source of truth) and neither has to pull
-- raw lifetime order/delivery rows into the browser to compute it client-side.
--
-- Analysis window: the same "last N months, including the current month"
-- bucketing already used throughout the app (orders.month / deliveries.month
-- generated columns, and the Reports page's recentMonths() convention) —
-- not a new analytics convention.
--
-- Area comparison group: active shops sharing the same area_id, INCLUDING the
-- shop itself — this matches the spec's worked examples literally (e.g. "Adajan
-- has Shop A/B/C, area average = (A+B+C)/3"). A shop needs at least one other
-- shop in its area (>= 2 total) for an area comparison to be considered
-- meaningful; a shop alone in its area reports "insufficient area data" rather
-- than trivially comparing itself to itself.
--
-- Area averages use a per-shop-then-average methodology throughout (product
-- mix %, order frequency, monthly sales — each metric is computed for every
-- eligible shop individually, then averaged across shops), never a raw
-- combined total re-divided — mirrors "area average = average per shop, not
-- the area's total" from the spec.
CREATE OR REPLACE FUNCTION public.shop_analysis(p_shop_id uuid, p_months int DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_area_id uuid;
  v_shop_name text;
  v_area_name text;
  v_window_start date := (date_trunc('month', CURRENT_DATE) - ((p_months - 1) || ' months')::interval)::date;
  v_window_end date := (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date;
  v_area_shop_count int := 0;
  v_active_products jsonb;
  v_shop_total_qty numeric := 0;
  v_shop_mix jsonb := '[]'::jsonb;
  v_area_mix jsonb := '[]'::jsonb;
  v_area_mix_shops int := 0;
  v_shop_freq_days numeric;
  v_shop_order_count int := 0;
  v_area_freq_days numeric;
  v_area_freq_shops int := 0;
  v_shop_sales_avg numeric;
  v_shop_active_months int := 0;
  v_shop_sales_by_product jsonb := '[]'::jsonb;
  v_area_sales_avg numeric;
  v_area_sales_shops int := 0;
  v_area_sales_by_product jsonb := '[]'::jsonb;
BEGIN
  SELECT area_id, shop_name INTO v_area_id, v_shop_name FROM shops WHERE id = p_shop_id;
  IF v_shop_name IS NULL THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  IF v_area_id IS NOT NULL THEN
    SELECT name INTO v_area_name FROM shop_areas WHERE id = v_area_id;
    SELECT COUNT(*) INTO v_area_shop_count FROM shops WHERE area_id = v_area_id AND is_active;
  END IF;

  -- ---------- Active products (shop_products is the definition of "works with") ----------
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'key', p.key, 'name', p.name,
           'shortName', p.short_name, 'sortOrder', p.sort_order
         ) ORDER BY p.sort_order), '[]'::jsonb)
    INTO v_active_products
    FROM shop_products sp JOIN products p ON p.id = sp.product_id
   WHERE sp.shop_id = p_shop_id;

  -- ---------- Product mix: this shop ----------
  WITH shop_qty AS (
    SELECT ol.product_id, SUM(ol.qty) AS qty
      FROM order_lines ol JOIN orders o ON o.id = ol.order_id
     WHERE o.shop_id = p_shop_id AND o.month BETWEEN v_window_start AND v_window_end
     GROUP BY ol.product_id
  ),
  totaled AS (SELECT *, SUM(qty) OVER () AS total_qty FROM shop_qty)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'productId', p.id, 'shortName', p.short_name, 'sortOrder', p.sort_order,
           'qty', t.qty, 'sharePct', ROUND(t.qty / t.total_qty * 100, 2)
         ) ORDER BY p.sort_order), '[]'::jsonb),
         COALESCE(MAX(t.total_qty), 0)
    INTO v_shop_mix, v_shop_total_qty
    FROM totaled t JOIN products p ON p.id = t.product_id;

  -- ---------- Product mix: area average (per eligible shop's own %, then averaged) ----------
  IF v_area_shop_count >= 2 THEN
    WITH area_shop_qty AS (
      SELECT o.shop_id, ol.product_id, SUM(ol.qty) AS qty
        FROM order_lines ol JOIN orders o ON o.id = ol.order_id JOIN shops s ON s.id = o.shop_id
       WHERE s.area_id = v_area_id AND s.is_active AND o.month BETWEEN v_window_start AND v_window_end
       GROUP BY o.shop_id, ol.product_id
    ),
    area_shop_total AS (
      SELECT shop_id, SUM(qty) AS total FROM area_shop_qty GROUP BY shop_id HAVING SUM(qty) > 0
    ),
    area_pct AS (
      SELECT q.product_id, AVG(q.qty / t.total * 100) AS avg_pct
        FROM area_shop_qty q JOIN area_shop_total t ON t.shop_id = q.shop_id
       GROUP BY q.product_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'productId', x.product_id, 'shortName', p.short_name, 'sortOrder', p.sort_order,
             'sharePct', ROUND(x.avg_pct, 2)
           ) ORDER BY p.sort_order), '[]'::jsonb),
           COALESCE((SELECT COUNT(*) FROM area_shop_total), 0)
      INTO v_area_mix, v_area_mix_shops
      FROM area_pct x JOIN products p ON p.id = x.product_id;
  END IF;

  -- ---------- Order frequency: this shop (actual order_date, not delivery_date) ----------
  WITH shop_dates AS (
    SELECT order_date FROM orders
     WHERE shop_id = p_shop_id AND month BETWEEN v_window_start AND v_window_end AND order_date IS NOT NULL
  ),
  gaps AS (
    SELECT order_date - LAG(order_date) OVER (ORDER BY order_date) AS gap FROM shop_dates
  )
  SELECT (SELECT COUNT(*) FROM shop_dates), AVG(gap)
    INTO v_shop_order_count, v_shop_freq_days
    FROM gaps WHERE gap IS NOT NULL;

  -- ---------- Order frequency: area average (per eligible shop's own avg, then averaged) ----------
  IF v_area_shop_count >= 2 THEN
    WITH area_gaps AS (
      SELECT o.shop_id, o.order_date - LAG(o.order_date) OVER (PARTITION BY o.shop_id ORDER BY o.order_date) AS gap
        FROM orders o JOIN shops s ON s.id = o.shop_id
       WHERE s.area_id = v_area_id AND s.is_active
         AND o.month BETWEEN v_window_start AND v_window_end AND o.order_date IS NOT NULL
    ),
    per_shop AS (
      SELECT shop_id, AVG(gap) AS avg_days FROM area_gaps WHERE gap IS NOT NULL GROUP BY shop_id
    )
    SELECT COUNT(*), AVG(avg_days) INTO v_area_freq_shops, v_area_freq_days FROM per_shop;
    v_area_freq_shops := COALESCE(v_area_freq_shops, 0);
  END IF;

  -- ---------- Monthly sales: this shop (delivered sales = the app's recognized-sales source) ----------
  WITH shop_months AS (
    SELECT month, SUM(total_sales) AS sales
      FROM deliveries
     WHERE shop_id = p_shop_id AND month BETWEEN v_window_start AND v_window_end
     GROUP BY month
  )
  SELECT COUNT(*), CASE WHEN COUNT(*) > 0 THEN SUM(sales) / COUNT(*) END
    INTO v_shop_active_months, v_shop_sales_avg
    FROM shop_months;

  IF v_shop_active_months > 0 THEN
    WITH prod AS (
      SELECT dl.product_id, SUM(dl.qty * pr.selling_price) AS amount
        FROM delivery_lines dl
        JOIN deliveries d ON d.id = dl.delivery_id
        JOIN products pr ON pr.id = dl.product_id
       WHERE d.shop_id = p_shop_id AND d.month BETWEEN v_window_start AND v_window_end
       GROUP BY dl.product_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'productId', p.id, 'shortName', p.short_name, 'sortOrder', p.sort_order,
             'average', ROUND(x.amount / v_shop_active_months, 2)
           ) ORDER BY p.sort_order), '[]'::jsonb)
      INTO v_shop_sales_by_product
      FROM prod x JOIN products p ON p.id = x.product_id;
  END IF;

  -- ---------- Monthly sales: area average (per eligible shop's own avg, then averaged) ----------
  IF v_area_shop_count >= 2 THEN
    WITH area_shop_months AS (
      SELECT d.shop_id, d.month, SUM(d.total_sales) AS sales
        FROM deliveries d JOIN shops s ON s.id = d.shop_id
       WHERE s.area_id = v_area_id AND s.is_active AND d.month BETWEEN v_window_start AND v_window_end
       GROUP BY d.shop_id, d.month
    ),
    area_shop_avg AS (
      SELECT shop_id, SUM(sales) / COUNT(*) AS avg_sales, COUNT(*) AS active_months
        FROM area_shop_months GROUP BY shop_id
    )
    SELECT COUNT(*), AVG(avg_sales) INTO v_area_sales_shops, v_area_sales_avg FROM area_shop_avg;
    v_area_sales_shops := COALESCE(v_area_sales_shops, 0);

    IF v_area_sales_shops > 0 THEN
      WITH area_shop_months AS (
        SELECT d.shop_id, d.month, SUM(d.total_sales) AS sales
          FROM deliveries d JOIN shops s ON s.id = d.shop_id
         WHERE s.area_id = v_area_id AND s.is_active AND d.month BETWEEN v_window_start AND v_window_end
         GROUP BY d.shop_id, d.month
      ),
      area_shop_avg AS (
        SELECT shop_id, SUM(sales) / COUNT(*) AS avg_sales, COUNT(*) AS active_months
          FROM area_shop_months GROUP BY shop_id
      ),
      prod AS (
        SELECT d.shop_id, dl.product_id, SUM(dl.qty * pr.selling_price) AS amount
          FROM delivery_lines dl
          JOIN deliveries d ON d.id = dl.delivery_id
          JOIN shops s ON s.id = d.shop_id
          JOIN products pr ON pr.id = dl.product_id
         WHERE s.area_id = v_area_id AND s.is_active AND d.month BETWEEN v_window_start AND v_window_end
         GROUP BY d.shop_id, dl.product_id
      ),
      per_shop_avg AS (
        SELECT x.product_id, x.amount / a.active_months AS avg_amount
          FROM prod x JOIN area_shop_avg a ON a.shop_id = x.shop_id
      )
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'productId', y.product_id, 'shortName', p.short_name, 'sortOrder', p.sort_order,
               'average', ROUND(y.avg_amount, 2)
             ) ORDER BY p.sort_order), '[]'::jsonb)
        INTO v_area_sales_by_product
        FROM (SELECT product_id, AVG(avg_amount) AS avg_amount FROM per_shop_avg GROUP BY product_id) y
        JOIN products p ON p.id = y.product_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'shop', jsonb_build_object(
      'id', p_shop_id, 'name', v_shop_name,
      'areaId', v_area_id, 'areaName', v_area_name
    ),
    'analysisPeriod', jsonb_build_object(
      'months', p_months, 'label', 'Last ' || p_months || ' Months',
      'startDate', v_window_start, 'endDate', v_window_end
    ),
    'activeProducts', v_active_products,
    'productMix', jsonb_build_object(
      'shop', v_shop_mix, 'shopTotalQty', v_shop_total_qty,
      'area', v_area_mix, 'areaEligibleShops', v_area_mix_shops
    ),
    'orderFrequency', jsonb_build_object(
      'shop', CASE WHEN v_shop_freq_days IS NOT NULL
                THEN jsonb_build_object('avgDays', ROUND(v_shop_freq_days, 1), 'orderCount', v_shop_order_count)
                ELSE NULL END,
      'area', CASE WHEN v_area_freq_days IS NOT NULL
                THEN jsonb_build_object('avgDays', ROUND(v_area_freq_days, 1), 'eligibleShops', v_area_freq_shops)
                ELSE NULL END
    ),
    'monthlySales', jsonb_build_object(
      'shop', CASE WHEN v_shop_sales_avg IS NOT NULL
                THEN jsonb_build_object('average', ROUND(v_shop_sales_avg, 2), 'activeMonths', v_shop_active_months, 'byProduct', v_shop_sales_by_product)
                ELSE NULL END,
      'area', CASE WHEN v_area_sales_avg IS NOT NULL
                THEN jsonb_build_object('average', ROUND(v_area_sales_avg, 2), 'eligibleShops', v_area_sales_shops, 'byProduct', v_area_sales_by_product)
                ELSE NULL END,
      'areaEligibleShopCount', v_area_shop_count
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.shop_analysis(uuid, int) TO authenticated;
