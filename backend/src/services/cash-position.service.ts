import { Collection } from "../models/collection.model.js";
import { DirectSale } from "../models/direct-sale.model.js";
import { Investment, Payout, VariableCost } from "../models/finance.model.js";
import { Payment } from "../models/order.model.js";
import { round2 } from "../utils/date.js";

/**
 * Cash Position — all-time totals, never scoped to a month.
 *
 *   Money in hand = Investments + Payments received + Direct sale payments
 *                   − (Variable costs + Payouts + Change money paid)
 *
 * Change money only counts once a manager has marked it paid on the Manager
 * Dashboard — until then it is a claim, not cash that has left.
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
  directSalePaymentsTotal: number;
  variableCostsTotal: number;
  payoutsTotal: number;
  changeMoneyPaidTotal: number;
  moneyInHand: number;
};

async function total(
  model:
    | typeof Investment
    | typeof Payout
    | typeof VariableCost
    | typeof Payment
    | typeof Collection
    | typeof DirectSale,
  filter: Record<string, unknown> = {},
  field: "amount" | "amount_received" | "change_money" | "payment_amount" = "amount",
): Promise<number> {
  const [row] = await (model as typeof Investment).aggregate<{ total: number }>([
    { $match: filter },
    { $group: { _id: null, total: { $sum: `$${field}` } } },
  ]);
  return round2(row?.total ?? 0);
}

export async function cashPositionSummary(): Promise<CashPositionSummary> {
  const [
    investmentsTotal,
    byBhavin,
    byJaldeep,
    paymentsReceivedTotal,
    directSalePaymentsTotal,
    variableCostsTotal,
    payoutsTotal,
    changeMoneyPaidTotal,
  ] = await Promise.all([
    total(Investment),
    total(Investment, { done_by: "Bhavin" }),
    total(Investment, { done_by: "Jaldeep" }),
    // Every rupee actually collected, including instalments against bills
    // that are still only part paid.
    total(Payment, {}, "amount_received"),
    total(DirectSale, {}, "payment_amount"),
    total(VariableCost),
    total(Payout),
    total(Collection, { change_money_paid: true }, "change_money"),
  ]);

  return {
    investmentsTotal,
    investmentsByBhavin: byBhavin,
    investmentsByJaldeep: byJaldeep,
    paymentsReceivedTotal,
    directSalePaymentsTotal,
    variableCostsTotal,
    payoutsTotal,
    changeMoneyPaidTotal,
    moneyInHand: round2(
      investmentsTotal +
        paymentsReceivedTotal +
        directSalePaymentsTotal -
        (variableCostsTotal + payoutsTotal + changeMoneyPaidTotal),
    ),
  };
}
