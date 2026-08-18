-- payments.collected_date: the date a payment was actually collected, distinct
-- from payment_date (the date the payment was raised from a delivery, which
-- drives the `month` generated column everything else filters by). Set from
-- either the shop detail page's "mark Received" dialog or the Payments page's
-- inline column — both read/write this same field.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS collected_date date;
