-- Bill generation (Invoice + Delivery Challan PDFs from the Delivery Sheet).
--
-- 1. products.unit — there's no unit-of-sale column on products today. Added
--    as a real column (not hardcoded in the bill-generation code) so it
--    survives future product additions, backfilled from the stable `key`
--    column exactly like every other product-identity lookup in this app.
-- 2. invoices — one row per order, auto-incrementing invoice_no. Invoice
--    numbers must be stable (same order -> same number every time the bill
--    is regenerated) and race-safe when "Generate all bills" processes many
--    orders at once, so allocation happens via a single atomic
--    INSERT ... ON CONFLICT DO NOTHING inside get_or_create_invoice_no().

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT '';

UPDATE public.products SET unit = CASE key
  WHEN 'dw200' THEN 'Pouch'
  WHEN 'dw350' THEN 'Jar'
  WHEN 'dw480' THEN 'Jar'
  WHEN 'll500' THEN 'Can'
  WHEN 'll700' THEN 'Can'
  WHEN 'tc60' THEN 'Bottle'
  ELSE unit
END
WHERE unit = '';

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  invoice_no serial,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_all_auth ON public.invoices;
CREATE POLICY invoices_all_auth ON public.invoices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.get_or_create_invoice_no(p_order_id uuid)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_no int;
BEGIN
  INSERT INTO invoices (order_id) VALUES (p_order_id)
    ON CONFLICT (order_id) DO NOTHING;

  SELECT invoice_no INTO v_no FROM invoices WHERE order_id = p_order_id;
  RETURN v_no;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_invoice_no(uuid) TO authenticated, service_role;
