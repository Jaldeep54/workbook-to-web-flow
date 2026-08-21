-- shops.bill_name: a third name alongside shop_name (the shop's real name) and
-- label_name (printed on labels) — the name to print on invoices/delivery
-- challans. Nullable so existing shops fall back to shop_name until set.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS bill_name text;
