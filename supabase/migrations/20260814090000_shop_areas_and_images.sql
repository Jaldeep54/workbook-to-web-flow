-- ============ shop areas ============
-- Normalized area lookup instead of a free-text field on shops, so every
-- module (map, orders, deliveries, payments, SKU opportunity...) reads the
-- same area value from the same place.
CREATE TABLE IF NOT EXISTS public.shop_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case/whitespace-insensitive uniqueness so "Varachha", "varachha " and
-- "VARACHHA" can't all end up as separate rows.
CREATE UNIQUE INDEX IF NOT EXISTS shop_areas_name_unique_idx
  ON public.shop_areas (lower(btrim(name)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_areas TO authenticated;
GRANT ALL ON public.shop_areas TO service_role;
ALTER TABLE public.shop_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_areas_all_auth ON public.shop_areas;
CREATE POLICY shop_areas_all_auth ON public.shop_areas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS shop_areas_touch ON public.shop_areas;
CREATE TRIGGER shop_areas_touch BEFORE UPDATE ON public.shop_areas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Case/whitespace-safe "find or create" — avoids a client-side
-- check-then-insert race creating duplicate areas.
CREATE OR REPLACE FUNCTION public.upsert_shop_area(p_name text)
RETURNS public.shop_areas
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row public.shop_areas;
  v_clean text := btrim(p_name);
BEGIN
  IF v_clean = '' THEN
    RAISE EXCEPTION 'Area name cannot be empty';
  END IF;

  SELECT * INTO v_row FROM shop_areas WHERE lower(name) = lower(v_clean) LIMIT 1;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  BEGIN
    INSERT INTO shop_areas (name) VALUES (v_clean) RETURNING * INTO v_row;
    RETURN v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row FROM shop_areas WHERE lower(name) = lower(v_clean) LIMIT 1;
    RETURN v_row;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_shop_area(text) TO authenticated;

-- ============ shops: area + image ============
-- Nullable: existing shops have no area yet and must keep working.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES public.shop_areas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS shops_area_idx ON public.shops (area_id);

-- Storage object path (e.g. "<shop_id>/<timestamp>-<filename>"), not binary
-- data and not a signed URL (those expire).
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS image_path text;

-- shops.code / next_shop_code() are intentionally left untouched — the Excel
-- importer (src/lib/import-workbook.ts) still matches shops by code, so the
-- column stays as an internal identifier even though the UI no longer shows
-- or collects it.

-- ============ shop images storage bucket ============
-- Private bucket (matches the rest of the app: every table requires
-- `authenticated`, nothing is public). Viewing requires a signed URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('shop-images', 'shop-images', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS shop_images_authenticated_select ON storage.objects;
CREATE POLICY shop_images_authenticated_select ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'shop-images');

DROP POLICY IF EXISTS shop_images_authenticated_insert ON storage.objects;
CREATE POLICY shop_images_authenticated_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'shop-images');

DROP POLICY IF EXISTS shop_images_authenticated_update ON storage.objects;
CREATE POLICY shop_images_authenticated_update ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'shop-images') WITH CHECK (bucket_id = 'shop-images');

DROP POLICY IF EXISTS shop_images_authenticated_delete ON storage.objects;
CREATE POLICY shop_images_authenticated_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'shop-images');
