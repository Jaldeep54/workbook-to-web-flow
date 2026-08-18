-- Cash Position: Investments and Payouts, both manually entered running
-- ledgers (not scoped to a month) feeding the Cash Position page's
-- "Money In Hand" figure = Investments + Payments Received - (Variable Costs
-- + Payouts), summed across all time.
CREATE TABLE public.investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_date date NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  done_by text NOT NULL CHECK (done_by IN ('Bhavin', 'Jaldeep')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.investments TO authenticated;
GRANT ALL ON public.investments TO service_role;
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "investments_all_auth" ON public.investments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX investments_date_idx ON public.investments (investment_date);

-- Same shape as investments, but for money paid out to manufacturers, label
-- suppliers, etc. — no per-person breakdown needed on this one.
CREATE TABLE public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_date date NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  done_by text NOT NULL CHECK (done_by IN ('Bhavin', 'Jaldeep')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payouts TO authenticated;
GRANT ALL ON public.payouts TO service_role;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payouts_all_auth" ON public.payouts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX payouts_date_idx ON public.payouts (payout_date);

-- All-time totals for the Cash Position page — same reasoning as
-- dashboard_summary()/shop_analysis(): one RPC computing every figure the
-- page needs so it's never re-derived by pulling every payment/cost row
-- into the browser.
CREATE OR REPLACE FUNCTION public.cash_position_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'investmentsTotal', (SELECT COALESCE(SUM(amount), 0) FROM investments),
    'investmentsByBhavin', (SELECT COALESCE(SUM(amount), 0) FROM investments WHERE done_by = 'Bhavin'),
    'investmentsByJaldeep', (SELECT COALESCE(SUM(amount), 0) FROM investments WHERE done_by = 'Jaldeep'),
    'paymentsReceivedTotal', (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'Received'),
    'variableCostsTotal', (SELECT COALESCE(SUM(amount), 0) FROM variable_costs),
    'payoutsTotal', (SELECT COALESCE(SUM(amount), 0) FROM payouts)
  );
$$;

GRANT EXECUTE ON FUNCTION public.cash_position_summary() TO authenticated;
