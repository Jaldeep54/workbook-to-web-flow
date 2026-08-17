-- Label Order Suggestion: one RPC that turns each shop's actual product order
-- history into a per-shop, per-label-type recommended print-order quantity,
-- for the "Label Order Suggestion" tab beside the existing "Label Orders" tab.
--
-- Labels can never be shared between shops (every shop's label carries its own
-- printed shop name), so every figure here is scoped to one shop x one
-- label_product — never combined across shops.
--
-- Reused, not reimplemented:
--   - "current stock" uses the exact same formula as label_stock_view
--     (SUM(label_order_lines.products) received − SUM(order_lines.qty) used).
--     Since placing a label_orders row already counts as +stock immediately in
--     this app's existing model (there is no separate "received" vs "pending"
--     status on label orders), that stock figure is already net of everything
--     ordered to date — nothing further needs to be subtracted for "pending"
--     orders.
--   - "labels per sheet" / "sheet cost" come from label_products, never
--     hard-coded.
--   - consumption is read from order_lines/orders (product-level), exactly
--     like label_stock_view's "used" — because every unit of a product sold
--     consumes exactly one of each label type tied to that product (so
--     LL700 Front and LL700 Back each get their own suggestion, computed
--     independently, but from the same underlying LL700 product consumption).
--
-- Forecast: a recency-weighted average of the last p_history_months (default
-- 6) months of order_lines, weight = (history window length − recency rank +
-- 1), so the most recent month counts most and each older month counts
-- proportionally less — simple, deterministic, no ML. "Growth" compares the
-- last 2 months' average against the 4 months before that; more than 25%
-- higher flags is_growth. A shop/product with fewer than 3 months of order
-- history is flagged has_limited_history so the UI can say so explicitly.
--
-- Target stock = monthly forecast × p_months_target × (1 + p_safety_buffer_pct)
-- — i.e. the 2-month requirement plus a buffer that is a percentage of that
-- requirement (this matches the worked example: 15/month × 2 = 30, +10% = 33).
--
-- p_next_procurement_date drives the "Emergency" flag: if the shop is
-- projected (at its own daily consumption rate) to run out before that date,
-- it's flagged emergency regardless of whether it has technically reached the
-- 2-month target yet. The 1st/16th procurement-date business rule itself
-- lives in the frontend (matching how SHOP_ANALYSIS_MONTHS is a frontend
-- constant passed into shop_analysis()) — this function just does date math
-- against whatever date it's given.
CREATE OR REPLACE FUNCTION public.label_order_suggestions(
  p_next_procurement_date date,
  p_months_target int DEFAULT 2,
  p_safety_buffer_pct numeric DEFAULT 0.10,
  p_history_months int DEFAULT 6
)
RETURNS TABLE (
  shop_id uuid,
  shop_name text,
  shop_code text,
  label_product_id uuid,
  label_product_key text,
  label_product_name text,
  label_product_short_name text,
  label_product_sort_order int,
  product_id uuid,
  labels_per_sheet numeric,
  sheet_cost numeric,
  current_stock numeric,
  months_of_history int,
  has_limited_history boolean,
  monthly_forecast numeric,
  recent_avg numeric,
  baseline_avg numeric,
  is_growth boolean,
  two_month_requirement numeric,
  safety_buffer numeric,
  target_stock numeric,
  additional_requirement numeric,
  suggested_sheets int,
  daily_rate numeric,
  projected_stockout_date date,
  is_emergency boolean,
  status text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    -- Universe: every shop x label_product where the shop currently carries
    -- that product — the exact same scoping rule label_stock_view uses.
    SELECT s.id AS shop_id, s.shop_name, s.code AS shop_code,
           lp.id AS label_product_id, lp.key AS label_product_key, lp.name AS label_product_name,
           lp.short_name AS label_product_short_name, lp.sort_order AS label_product_sort_order,
           lp.product_id, lp.labels_per_sheet, lp.sheet_cost
      FROM shops s
      JOIN shop_products sp ON sp.shop_id = s.id
      JOIN label_products lp ON lp.product_id = sp.product_id
     WHERE s.is_active
  ),
  monthly_qty AS (
    SELECT o.shop_id, ol.product_id, o.month, SUM(ol.qty) AS qty
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
     WHERE o.month >= (date_trunc('month', CURRENT_DATE) - ((p_history_months - 1) || ' months')::interval)::date
       AND o.month <= date_trunc('month', CURRENT_DATE)::date
     GROUP BY o.shop_id, ol.product_id, o.month
  ),
  ranked AS (
    SELECT shop_id, product_id, qty,
           RANK() OVER (PARTITION BY shop_id, product_id ORDER BY month DESC) AS recency_rank
      FROM monthly_qty
  ),
  forecast AS (
    SELECT shop_id, product_id,
           COUNT(*) AS months_of_history,
           SUM(qty * (p_history_months - recency_rank + 1))
             / NULLIF(SUM(p_history_months - recency_rank + 1), 0) AS monthly_forecast,
           AVG(qty) FILTER (WHERE recency_rank <= 2) AS recent_avg,
           AVG(qty) FILTER (WHERE recency_rank BETWEEN 3 AND p_history_months) AS baseline_avg
      FROM ranked
     GROUP BY shop_id, product_id
  ),
  stock AS (
    -- Identical formula to label_stock_view's stock column.
    SELECT b.shop_id, b.label_product_id,
           COALESCE(recv.received, 0) - COALESCE(used.used, 0) AS current_stock
      FROM base b
      LEFT JOIN LATERAL (
        SELECT SUM(lol.products) AS received
          FROM label_order_lines lol JOIN label_orders lo ON lo.id = lol.label_order_id
         WHERE lo.shop_id = b.shop_id AND lol.label_product_id = b.label_product_id
      ) recv ON true
      LEFT JOIN LATERAL (
        SELECT SUM(ol.qty) AS used
          FROM order_lines ol JOIN orders o ON o.id = ol.order_id
         WHERE o.shop_id = b.shop_id AND ol.product_id = b.product_id
      ) used ON true
  ),
  joined AS (
    SELECT b.*,
           st.current_stock,
           COALESCE(f.months_of_history, 0) AS months_of_history,
           COALESCE(f.monthly_forecast, 0) AS monthly_forecast,
           f.recent_avg, f.baseline_avg
      FROM base b
      LEFT JOIN forecast f ON f.shop_id = b.shop_id AND f.product_id = b.product_id
      LEFT JOIN stock st ON st.shop_id = b.shop_id AND st.label_product_id = b.label_product_id
  ),
  computed AS (
    SELECT j.*,
           (j.months_of_history < 3) AS has_limited_history,
           (j.recent_avg IS NOT NULL AND j.baseline_avg IS NOT NULL
             AND j.baseline_avg > 0 AND j.recent_avg > j.baseline_avg * 1.25) AS is_growth,
           j.monthly_forecast * p_months_target AS two_month_requirement,
           j.monthly_forecast * p_months_target * p_safety_buffer_pct AS safety_buffer,
           j.monthly_forecast * p_months_target * (1 + p_safety_buffer_pct) AS target_stock,
           GREATEST(j.monthly_forecast * p_months_target * (1 + p_safety_buffer_pct) - j.current_stock, 0)
             AS additional_requirement,
           (j.monthly_forecast / 30.0) AS daily_rate,
           CASE WHEN j.monthly_forecast > 0
                THEN CURRENT_DATE + FLOOR(j.current_stock / (j.monthly_forecast / 30.0))::int
                ELSE NULL END AS projected_stockout_date
      FROM joined j
  )
  SELECT
    c.shop_id, c.shop_name, c.shop_code,
    c.label_product_id, c.label_product_key, c.label_product_name, c.label_product_short_name,
    c.label_product_sort_order, c.product_id, c.labels_per_sheet, c.sheet_cost,
    c.current_stock, c.months_of_history, c.has_limited_history,
    c.monthly_forecast, c.recent_avg, c.baseline_avg, c.is_growth,
    c.two_month_requirement, c.safety_buffer, c.target_stock, c.additional_requirement,
    COALESCE(CEIL(c.additional_requirement / NULLIF(c.labels_per_sheet, 0))::int, 0) AS suggested_sheets,
    c.daily_rate, c.projected_stockout_date,
    (c.projected_stockout_date IS NOT NULL AND c.projected_stockout_date < p_next_procurement_date) AS is_emergency,
    CASE
      WHEN c.projected_stockout_date IS NOT NULL AND c.projected_stockout_date < p_next_procurement_date THEN 'emergency'
      WHEN c.current_stock < c.target_stock THEN 'order_recommended'
      WHEN c.is_growth THEN 'watch'
      ELSE 'no_order'
    END AS status
  FROM computed c
  ORDER BY c.shop_name, c.label_product_sort_order;
$$;

GRANT EXECUTE ON FUNCTION public.label_order_suggestions(date, int, numeric, int) TO authenticated;
