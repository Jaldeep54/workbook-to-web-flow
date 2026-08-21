-- ============ roles & profiles ============
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "user_roles_select_self_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============ catalogue ============
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  short_name text NOT NULL,
  sort_order int NOT NULL,
  selling_price numeric(12,4) NOT NULL DEFAULT 0,
  production_cost numeric(12,4) NOT NULL DEFAULT 0,
  packaging_cost numeric(12,4) NOT NULL DEFAULT 0,
  label_cost_per_unit numeric(12,6) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_all_auth" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.label_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  short_name text NOT NULL,
  sort_order int NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  labels_per_sheet numeric(12,4) NOT NULL,
  sheet_cost numeric(12,4) NOT NULL,
  low_stock_threshold int NOT NULL DEFAULT 15,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_products TO authenticated;
GRANT ALL ON public.label_products TO service_role;
ALTER TABLE public.label_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "label_products_all_auth" ON public.label_products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER label_products_touch BEFORE UPDATE ON public.label_products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ shops ============
CREATE TABLE public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  folder_name text,
  shop_name text NOT NULL,
  label_name text,
  design_type int NOT NULL DEFAULT 1,
  address text,
  mobile text,
  handled_by text,
  joined_on date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shops_active_name_idx ON public.shops (is_active, shop_name);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shops TO authenticated;
GRANT ALL ON public.shops TO service_role;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shops_all_auth" ON public.shops FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER shops_touch BEFORE UPDATE ON public.shops FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ orders ============
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  order_no int NOT NULL,
  order_date date,
  month date GENERATED ALWAYS AS (order_date - (EXTRACT(DAY FROM order_date)::int - 1)) STORED,
  total_qty numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, order_no)
);
CREATE INDEX orders_month_idx ON public.orders (month);
CREATE INDEX orders_date_idx ON public.orders (order_date DESC);
CREATE INDEX orders_shop_date_idx ON public.orders (shop_id, order_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_all_auth" ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty numeric(14,2) NOT NULL DEFAULT 0,
  UNIQUE (order_id, product_id)
);
CREATE INDEX order_lines_order_idx ON public.order_lines (order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_lines TO authenticated;
GRANT ALL ON public.order_lines TO service_role;
ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_lines_all_auth" ON public.order_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ deliveries ============
CREATE TABLE public.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  delivery_date date,
  month date GENERATED ALWAYS AS (delivery_date - (EXTRACT(DAY FROM delivery_date)::int - 1)) STORED,
  status text,
  total_qty numeric(14,2) NOT NULL DEFAULT 0,
  total_sales numeric(14,2) NOT NULL DEFAULT 0,
  labelling_cost numeric(14,4) NOT NULL DEFAULT 0,
  packaging_cost numeric(14,4) NOT NULL DEFAULT 0,
  production_cost numeric(14,4) NOT NULL DEFAULT 0,
  total_fixed_cost numeric(14,4) NOT NULL DEFAULT 0,
  profit numeric(14,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_month_idx ON public.deliveries (month);
CREATE INDEX deliveries_date_idx ON public.deliveries (delivery_date);
CREATE INDEX deliveries_shop_date_idx ON public.deliveries (shop_id, delivery_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO authenticated;
GRANT ALL ON public.deliveries TO service_role;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deliveries_all_auth" ON public.deliveries FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER deliveries_touch BEFORE UPDATE ON public.deliveries FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.delivery_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty numeric(14,2) NOT NULL DEFAULT 0,
  UNIQUE (delivery_id, product_id)
);
CREATE INDEX delivery_lines_delivery_idx ON public.delivery_lines (delivery_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_lines TO authenticated;
GRANT ALL ON public.delivery_lines TO service_role;
ALTER TABLE public.delivery_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "delivery_lines_all_auth" ON public.delivery_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ payments ============
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_date date,
  month date GENERATED ALWAYS AS (payment_date - (EXTRACT(DAY FROM payment_date)::int - 1)) STORED,
  status text,
  collected_by text,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_month_idx ON public.payments (month);
CREATE INDEX payments_shop_date_idx ON public.payments (shop_id, payment_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_all_auth" ON public.payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER payments_touch BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ label orders ============
CREATE TABLE public.label_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  order_no int NOT NULL,
  order_date date,
  month date GENERATED ALWAYS AS (order_date - (EXTRACT(DAY FROM order_date)::int - 1)) STORED,
  total_labels numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, order_no)
);
CREATE INDEX label_orders_month_idx ON public.label_orders (month);
CREATE INDEX label_orders_shop_idx ON public.label_orders (shop_id, order_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_orders TO authenticated;
GRANT ALL ON public.label_orders TO service_role;
ALTER TABLE public.label_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "label_orders_all_auth" ON public.label_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER label_orders_touch BEFORE UPDATE ON public.label_orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.label_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_order_id uuid NOT NULL REFERENCES public.label_orders(id) ON DELETE CASCADE,
  label_product_id uuid NOT NULL REFERENCES public.label_products(id) ON DELETE RESTRICT,
  sheets numeric(14,2) NOT NULL DEFAULT 0,
  products numeric(14,2) NOT NULL DEFAULT 0,
  UNIQUE (label_order_id, label_product_id)
);
CREATE INDEX label_order_lines_order_idx ON public.label_order_lines (label_order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_order_lines TO authenticated;
GRANT ALL ON public.label_order_lines TO service_role;
ALTER TABLE public.label_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "label_order_lines_all_auth" ON public.label_order_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ variable costs ============
CREATE TABLE public.variable_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_date date NOT NULL,
  month date GENERATED ALWAYS AS (cost_date - (EXTRACT(DAY FROM cost_date)::int - 1)) STORED,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  cost_type text NOT NULL DEFAULT 'Other',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX variable_costs_month_idx ON public.variable_costs (month);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.variable_costs TO authenticated;
GRANT ALL ON public.variable_costs TO service_role;
ALTER TABLE public.variable_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "variable_costs_all_auth" ON public.variable_costs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER variable_costs_touch BEFORE UPDATE ON public.variable_costs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ seed catalogue from the Inputs sheet ============
INSERT INTO public.products (key, name, short_name, sort_order, selling_price, production_cost, packaging_cost, label_cost_per_unit) VALUES
  ('dw200', 'Dishwash Liquid 200', 'DW 200', 1, 95,  63,    7.5,   2.0),
  ('dw350', 'Dishwash Liquid 350', 'DW 350', 2, 175, 108,   23.86, 1.6),
  ('dw480', 'Dishwash Liquid 480', 'DW 480', 3, 235, 148.5, 23.86, 1.6),
  ('ll500', 'Laundry Liquid 500',  'LL 500', 4, 305, 189,   41.07, 2.285714),
  ('ll700', 'Laundry Liquid 700',  'LL 700', 5, 435, 270,   58.83, 5.5),
  ('tc60',  'Toilet Cleaner 60',   'TC 60',  6, 40,  22,    0,     3.142857);

INSERT INTO public.label_products (key, name, short_name, sort_order, product_id, labels_per_sheet, sheet_cost, low_stock_threshold)
SELECT v.key, v.name, v.short_name, v.sort_order, p.id, v.lps, v.sheet_cost, v.threshold
FROM (VALUES
  ('dw200',     'Dishwash Liquid 200',        'DW 200',   1, 'dw200', 8::numeric,  16::numeric, 16),
  ('dw350',     'Dishwash Liquid 350',        'DW 350',   2, 'dw350', 10, 16, 15),
  ('dw480',     'Dishwash Liquid 480',        'DW 480',   3, 'dw480', 10, 16, 15),
  ('ll500',     'Laundry Liquid 500',         'LL 500',   4, 'll500', 7,  16, 15),
  ('ll700front','Laundry Liquid 700 (Front)', 'LL 700 F', 5, 'll700', 4,  22, 15),
  ('ll700back', 'Laundry Liquid 700 (Back)',  'LL 700 B', 6, 'll700', 12, 16, 15),
  ('tc60',      'Toilet Cleaner 60',          'TC 60',    7, 'tc60',  7,  22, 42)
) AS v(key, name, short_name, sort_order, product_key, lps, sheet_cost, threshold)
JOIN public.products p ON p.key = v.product_key;