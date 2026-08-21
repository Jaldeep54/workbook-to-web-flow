-- Label Order Suggestion — rework the recommendation formula to be threshold-based.
--
-- Supersedes the label_order_suggestions(date, int, numeric, int) function added in
-- 20260817120000_label_order_suggestions.sql (procurement-date/safety-buffer/growth
-- design). That signature is dropped and replaced with a simpler one, per updated
-- business requirements:
--
--   Current stock       -> reused verbatim from label_stock_view (no second
--                           competing calculation of "received - used").
--   Low stock threshold -> label_products.low_stock_threshold, unchanged (still the
--                           same threshold the Label Stock table turns red on:
--                           stock < threshold).
--   Average monthly usage -> SUM(order_lines.qty) for the label's mapped product,
--                           via label_products.product_id (never matched by name),
--                           over the last p_history_months months (default 3 —
--                           matches shop_analysis()'s window: the current, possibly
--                           partial, month plus the preceding p_history_months - 1),
--                           divided by the fixed month count so a shop with data in
--                           only one of those months isn't inflated to that month's
--                           full rate.
--   1-month target       -> threshold + 1 x average monthly usage
--   2-month target       -> threshold + 2 x average monthly usage
--   Suggested sheets     -> CEIL(GREATEST(2-month target - current stock, 0) / labels_per_sheet)
--                           — never negative, never fractional, computed toward the
--                           2-month target regardless of status.
--   Status                (same threshold definition the Label Stock indicator uses):
--     current_stock < threshold                          -> urgent
--     threshold <= current_stock < 1-month target         -> recommended
--     1-month target <= current_stock < 2-month target    -> monitor
--     current_stock >= 2-month target                     -> no_order_required
--
-- Zero-usage products fall out of the same formula with no special-casing: when
-- avg_monthly_usage = 0, both targets collapse to the threshold itself, so a shop
-- at/above threshold is immediately no_order_required and a shop below it is
-- urgent with a small suggested quantity that only tops back up to the threshold.
--
-- Nothing here is stored — every value is computed dynamically on each call.
DROP FUNCTION IF EXISTS public.label_order_suggestions(date, int, numeric, int);

CREATE OR REPLACE FUNCTION public.label_order_suggestions(p_history_months int DEFAULT 3)
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
  low_stock_threshold numeric,
  current_stock numeric,
  avg_monthly_usage numeric,
  one_month_target numeric,
  two_month_target numeric,
  additional_required numeric,
  suggested_sheets int,
  expected_stock_after_order numeric,
  status text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    -- Universe: every shop x label_product where the shop currently carries that
    -- product — the exact same scoping rule label_stock_view uses.
    SELECT s.id AS shop_id, s.shop_name, s.code AS shop_code,
           lp.id AS label_product_id, lp.key AS label_product_key, lp.name AS label_product_name,
           lp.short_name AS label_product_short_name, lp.sort_order AS label_product_sort_order,
           lp.product_id, lp.labels_per_sheet, lp.sheet_cost, lp.low_stock_threshold::numeric AS low_stock_threshold
      FROM shops s
      JOIN shop_products sp ON sp.shop_id = s.id
      JOIN label_products lp ON lp.product_id = sp.product_id
     WHERE s.is_active
  ),
  usage AS (
    SELECT o.shop_id, ol.product_id, SUM(ol.qty) AS total_qty
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
     WHERE o.month >= (date_trunc('month', CURRENT_DATE) - ((p_history_months - 1) || ' months')::interval)::date
       AND o.month <= date_trunc('month', CURRENT_DATE)::date
     GROUP BY o.shop_id, ol.product_id
  ),
  joined AS (
    SELECT b.*,
           ls.stock AS current_stock,
           COALESCE(u.total_qty, 0) / p_history_months::numeric AS avg_monthly_usage
      FROM base b
      JOIN label_stock_view ls ON ls.shop_id = b.shop_id AND ls.label_product_id = b.label_product_id
      LEFT JOIN usage u ON u.shop_id = b.shop_id AND u.product_id = b.product_id
  ),
  computed AS (
    SELECT j.*,
           j.low_stock_threshold + j.avg_monthly_usage AS one_month_target,
           j.low_stock_threshold + 2 * j.avg_monthly_usage AS two_month_target
      FROM joined j
  )
  SELECT
    c.shop_id, c.shop_name, c.shop_code,
    c.label_product_id, c.label_product_key, c.label_product_name, c.label_product_short_name,
    c.label_product_sort_order, c.product_id, c.labels_per_sheet, c.sheet_cost, c.low_stock_threshold,
    c.current_stock, c.avg_monthly_usage, c.one_month_target, c.two_month_target,
    GREATEST(c.two_month_target - c.current_stock, 0) AS additional_required,
    COALESCE(CEIL(GREATEST(c.two_month_target - c.current_stock, 0) / NULLIF(c.labels_per_sheet, 0))::int, 0)
      AS suggested_sheets,
    c.current_stock
      + COALESCE(CEIL(GREATEST(c.two_month_target - c.current_stock, 0) / NULLIF(c.labels_per_sheet, 0)), 0)
        * c.labels_per_sheet AS expected_stock_after_order,
    CASE
      WHEN c.current_stock < c.low_stock_threshold THEN 'urgent'
      WHEN c.current_stock < c.one_month_target THEN 'recommended'
      WHEN c.current_stock < c.two_month_target THEN 'monitor'
      ELSE 'no_order_required'
    END AS status
  FROM computed c
  ORDER BY c.shop_name, c.label_product_sort_order;
$$;

GRANT EXECUTE ON FUNCTION public.label_order_suggestions(int) TO authenticated;
