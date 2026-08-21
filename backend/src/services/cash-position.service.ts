import { Investment, Payout, VariableCost } from "../models/finance.model.js";
import { Payment } from "../models/order.model.js";
import { round2 } from "../utils/date.js";

/**
 * Cash Position — all-time totals, never scoped to a month.
 *
 *   Money in hand = Investments + Payments received − (Variable costs + Payouts)
 *
 * Computed here rather than in the browser for the same reason the dashboard
 * is: one source of truth, and no pulling every payment/cost row to the client
 * just to add them up.
 */
export type CashPositionSummary = {
  investmentsTotal: number;
  investmentsByBhavin: number;
  investmentsByJaldeep: number;
  paymentsReceivedTotal: number;
  variableCostsTotal: number;
  payoutsTotal: number;
  moneyInHand: number;
};

async function total(
  model: typeof Investment | typeof Payout | typeof VariableCost | typeof Payment,
  filter: Record<string, unknown> = {},
): Promise<number> {
  const [row] = await (model as typeof Investment).aggregate<{ total: number }>([
    { $match: filter },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return round2(row?.total ?? 0);
}

export async function cashPositionSummary(): Promise<CashPositionSummary> {
  const [investmentsTotal, byBhavin, byJaldeep, paymentsReceivedTotal, variableCostsTotal, payoutsTotal] =
    await Promise.all([
      total(Investment),
      total(Investment, { done_by: "Bhavin" }),
      total(Investment, { done_by: "Jaldeep" }),
      total(Payment, { status: "Received" }),
      total(VariableCost),
      total(Payout),
    ]);

  return {
    investmentsTotal,
    investmentsByBhavin: byBhavin,
    investmentsByJaldeep: byJaldeep,
    paymentsReceivedTotal,
    variableCostsTotal,
    payoutsTotal,
    moneyInHand: round2(
      investmentsTotal + paymentsReceivedTotal - (variableCostsTotal + payoutsTotal),
    ),
  };
}
