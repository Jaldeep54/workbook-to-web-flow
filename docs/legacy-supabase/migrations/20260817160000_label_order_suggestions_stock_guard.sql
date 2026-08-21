-- Label Order Suggestion — negative-stock guard.
--
-- Ports one correctness fix from the parallel "v2" iteration of this feature
-- (PR #10, since superseded on this branch by the threshold-based formula):
-- negative current_stock (a data/test-data inconsistency — received < used)
-- must never inflate the recommended quantity. A shop sitting at -40 has to
-- be treated exactly like a shop sitting at 0 for every downstream
-- calculation (additional_required, suggested_sheets, status) — never
-- "0 + 40 extra". The raw (possibly negative) figure is still returned as
-- `current_stock` for display, and `has_stock_data_issue` flags it so the UI
-- can surface a warning instead of silently treating it as ordinary demand.
--
-- Threshold-based targets themselves are unchanged from
-- 20260817130000_label_order_suggestions_threshold_based.sql.
-- Drop every prior overload/signature this function has had on either lineage
-- (the pre-threshold emergency/procurement-date model this branch superseded,
-- and its own "v2" refinement) so exactly one function object survives.
DROP FUNCTION IF EXISTS public.label_order_suggestions(date, int, numeric, int);
DROP FUNCTION IF EXISTS public.label_order_suggestions(int);

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
  has_stock_data_issue boolean,
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
           GREATEST(ls.stock, 0) AS effective_stock,
           COALESCE(u.total_qty, 0) / p_history_months::numeric AS avg_monthly_usage
      FROM base b
      JOIN label_stock_view ls ON ls.shop_id = b.shop_id AND ls.label_product_id = b.label_product_id
      LEFT JOIN usage u ON u.shop_id = b.shop_id AND u.product_id = b.product_id
  ),
  computed AS (
    SELECT j.*,
           (j.current_stock < 0) AS has_stock_data_issue,
           j.low_stock_threshold + j.avg_monthly_usage AS one_month_target,
           j.low_stock_threshold + 2 * j.avg_monthly_usage AS two_month_target
      FROM joined j
  )
  SELECT
    c.shop_id, c.shop_name, c.shop_code,
    c.label_product_id, c.label_product_key, c.label_product_name, c.label_product_short_name,
    c.label_product_sort_order, c.product_id, c.labels_per_sheet, c.sheet_cost, c.low_stock_threshold,
    c.current_stock, c.has_stock_data_issue, c.avg_monthly_usage, c.one_month_target, c.two_month_target,
    GREATEST(c.two_month_target - c.effective_stock, 0) AS additional_required,
    COALESCE(CEIL(GREATEST(c.two_month_target - c.effective_stock, 0) / NULLIF(c.labels_per_sheet, 0))::int, 0)
      AS suggested_sheets,
    c.current_stock
      + COALESCE(CEIL(GREATEST(c.two_month_target - c.effective_stock, 0) / NULLIF(c.labels_per_sheet, 0)), 0)
        * c.labels_per_sheet AS expected_stock_after_order,
    CASE
      WHEN c.effective_stock < c.low_stock_threshold THEN 'urgent'
      WHEN c.effective_stock < c.one_month_target THEN 'recommended'
      WHEN c.effective_stock < c.two_month_target THEN 'monitor'
      ELSE 'no_order_required'
    END AS status
  FROM computed c
  ORDER BY c.shop_name, c.label_product_sort_order;
$$;

GRANT EXECUTE ON FUNCTION public.label_order_suggestions(int) TO authenticated;
