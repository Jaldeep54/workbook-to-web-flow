-- Label Order Suggestion v2 — refines label_order_suggestions() to match the
-- final Klinzo business spec without touching its callers' contract (same
-- params, all prior output columns kept — only new columns appended):
--
--   1. Negative stock (test data, per business rule) must never inflate the
--      recommended quantity — a shop sitting at -40 must be treated exactly
--      like a shop sitting at 0 for gap/target math, never "0 + 40 extra".
--      Added `effective_stock = GREATEST(current_stock, 0)` and driven every
--      downstream calculation (additional_requirement, stockout date, watch
--      window) off it instead of the raw figure. Negative stock is still
--      surfaced via `has_stock_data_issue` so the UI can flag it, per "treat
--      as a data/test inconsistency, not normal demand".
--   2. A shop/label with zero order history AND zero-or-negative stock is a
--      genuine new-shop-needs-its-initial-order case, not "no data => no
--      action". Flagged via `is_new_shop`, surfaced as order_recommended
--      (never guessed at a quantity — there's no stored "standard initial
--      sheets" table to reuse, so suggested_sheets stays 0 and the printer
--      operator fills it in by hand, exactly as today's manual "New label
--      order" flow already works).
--   3. WATCH is broadened from "is_growth only" to also catch a shop that is
--      still above its 2-month target today but, at its own recent daily
--      rate, will cross below that target within ~30 days — "still has
--      stock but is likely to need labels soon" (spec's Watch definition),
--      not just shops whose recent consumption jumped >25%.
--   4. Added a canned, deterministic `reason` sentence per row so the UI's
--      "Why?" panel doesn't have to reverse-engineer one from the numbers.
DROP FUNCTION IF EXISTS public.label_order_suggestions(date, int, numeric, int);

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
  is_new_shop boolean,
  has_stock_data_issue boolean,
  status text,
  reason text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
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
    -- Identical formula to label_stock_view's stock column — raw, can be negative.
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
           (j.months_of_history = 0) AS is_new_shop,
           (j.current_stock < 0) AS has_stock_data_issue,
           GREATEST(j.current_stock, 0) AS effective_stock,
           (j.recent_avg IS NOT NULL AND j.baseline_avg IS NOT NULL
             AND j.baseline_avg > 0 AND j.recent_avg > j.baseline_avg * 1.25) AS is_growth,
           j.monthly_forecast * p_months_target AS two_month_requirement,
           j.monthly_forecast * p_months_target * p_safety_buffer_pct AS safety_buffer,
           j.monthly_forecast * p_months_target * (1 + p_safety_buffer_pct) AS target_stock,
           (j.monthly_forecast / 30.0) AS daily_rate
      FROM joined j
  ),
  gapped AS (
    SELECT c.*,
           GREATEST(c.target_stock - c.effective_stock, 0) AS additional_requirement,
           CASE WHEN c.daily_rate > 0
                THEN CURRENT_DATE + FLOOR(c.effective_stock / c.daily_rate)::int
                ELSE NULL END AS projected_stockout_date,
           -- Only meaningful when currently at/above target: days until consumption
           -- would carry the shop back below its 2-month target ("still has stock,
           -- but will soon need labels").
           CASE WHEN c.daily_rate > 0 AND c.effective_stock >= c.target_stock
                THEN (c.effective_stock - c.target_stock) / c.daily_rate
                ELSE NULL END AS days_until_below_target
      FROM computed c
  )
  SELECT
    g.shop_id, g.shop_name, g.shop_code,
    g.label_product_id, g.label_product_key, g.label_product_name, g.label_product_short_name,
    g.label_product_sort_order, g.product_id, g.labels_per_sheet, g.sheet_cost,
    g.current_stock, g.months_of_history, g.has_limited_history,
    g.monthly_forecast, g.recent_avg, g.baseline_avg, g.is_growth,
    g.two_month_requirement, g.safety_buffer, g.target_stock, g.additional_requirement,
    COALESCE(CEIL(g.additional_requirement / NULLIF(g.labels_per_sheet, 0))::int, 0) AS suggested_sheets,
    g.daily_rate, g.projected_stockout_date,
    (g.projected_stockout_date IS NOT NULL AND g.projected_stockout_date < p_next_procurement_date) AS is_emergency,
    g.is_new_shop, g.has_stock_data_issue,
    CASE
      WHEN g.is_new_shop AND g.effective_stock <= 0 THEN 'order_recommended'
      WHEN g.projected_stockout_date IS NOT NULL AND g.projected_stockout_date < p_next_procurement_date THEN 'emergency'
      WHEN g.effective_stock < g.target_stock THEN 'order_recommended'
      WHEN g.is_new_shop THEN 'no_order'
      WHEN g.is_growth THEN 'watch'
      WHEN g.days_until_below_target IS NOT NULL AND g.days_until_below_target <= 30 THEN 'watch'
      ELSE 'no_order'
    END AS status,
    (
      CASE
        WHEN g.is_new_shop AND g.effective_stock <= 0 THEN 'New shop — initial label order.'
        WHEN g.projected_stockout_date IS NOT NULL AND g.projected_stockout_date < p_next_procurement_date THEN 'Projected to run out before next planning cycle.'
        WHEN g.effective_stock < g.target_stock AND g.is_growth THEN 'Current stock below 2-month target and sales trend increasing.'
        WHEN g.effective_stock < g.target_stock THEN 'Current stock below 2-month target.'
        WHEN g.is_new_shop THEN 'New shop — starting stock currently sufficient.'
        WHEN g.is_growth THEN 'Sales trend increasing — labels may soon be required.'
        WHEN g.days_until_below_target IS NOT NULL AND g.days_until_below_target <= 30 THEN 'Current stock sufficient, but recent consumption trend suggests labels will soon be required.'
        ELSE 'Current stock sufficient.'
      END
      || CASE WHEN g.has_stock_data_issue
              THEN ' Stock data issue: recorded stock is negative (test data) — treated as zero for this recommendation.'
              ELSE '' END
    ) AS reason
  FROM gapped g
  ORDER BY g.shop_name, g.label_product_sort_order;
$$;

GRANT EXECUTE ON FUNCTION public.label_order_suggestions(date, int, numeric, int) TO authenticated;
