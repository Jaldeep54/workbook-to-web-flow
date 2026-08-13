-- Shop location: latitude/longitude for the map features. Reuses the existing
-- shops.address column rather than duplicating it.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS latitude numeric(9,6);
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS longitude numeric(9,6);

COMMENT ON COLUMN public.shops.latitude IS 'Shop location latitude, WGS84 decimal degrees.';
COMMENT ON COLUMN public.shops.longitude IS 'Shop location longitude, WGS84 decimal degrees.';

CREATE INDEX IF NOT EXISTS shops_location_idx
  ON public.shops (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
