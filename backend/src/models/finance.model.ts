import { Schema, model } from "mongoose";

import { monthKey } from "../utils/date.js";
import { ISO_DATE_MATCH, schemaOptions, uuidId } from "./base.js";

export const COST_TYPES = ["Transportation", "Variable Label Cost", "Others"] as const;
/** The only two people who record investments/payouts (Cash Position). */
export const CASH_POSITION_PEOPLE = ["Bhavin", "Jaldeep"] as const;
export type CashPositionPerson = (typeof CASH_POSITION_PEOPLE)[number];

/**
 * Business-wide variable cost register — deliberately has no shop/area
 * dimension (transport, salaries, ...), which is why the area-scoped dashboard
 * still reports the whole business's figure for it.
 */
export interface IVariableCost {
  _id: string;
  cost_date: string;
  month: string | null;
  amount: number;
  cost_type: string;
  note: string | null;
  created_at?: Date;
  updated_at?: Date;
}

const variableCostSchema = new Schema<IVariableCost>(
  {
    _id: uuidId,
    cost_date: { type: String, required: true, match: ISO_DATE_MATCH },
    month: { type: String, default: null, match: ISO_DATE_MATCH },
    amount: { type: Number, default: 0, min: 0 },
    cost_type: { type: String, default: "Others", trim: true },
    note: { type: String, default: null, maxlength: 500 },
  },
  schemaOptions(),
);

variableCostSchema.index({ month: 1, cost_date: -1 });

variableCostSchema.pre("validate", function assignMonth(next) {
  this.month = monthKey(this.cost_date);
  next();
});

export const VariableCost = model<IVariableCost>("VariableCost", variableCostSchema, "variable_costs");

/** Running ledgers behind Cash Position — never scoped to a month. */
export interface IInvestment {
  _id: string;
  investment_date: string;
  amount: number;
  done_by: CashPositionPerson;
  created_at?: Date;
  updated_at?: Date;
}

const investmentSchema = new Schema<IInvestment>(
  {
    _id: uuidId,
    investment_date: { type: String, required: true, match: ISO_DATE_MATCH },
    amount: { type: Number, default: 0, min: 0 },
    done_by: { type: String, required: true, enum: CASH_POSITION_PEOPLE },
  },
  schemaOptions(),
);

investmentSchema.index({ investment_date: -1 });
investmentSchema.index({ done_by: 1 });

export const Investment = model<IInvestment>("Investment", investmentSchema, "investments");

export interface IPayout {
  _id: string;
  payout_date: string;
  amount: number;
  done_by: CashPositionPerson;
  created_at?: Date;
  updated_at?: Date;
}

const payoutSchema = new Schema<IPayout>(
  {
    _id: uuidId,
    payout_date: { type: String, required: true, match: ISO_DATE_MATCH },
    amount: { type: Number, default: 0, min: 0 },
    done_by: { type: String, required: true, enum: CASH_POSITION_PEOPLE },
  },
  schemaOptions(),
);

payoutSchema.index({ payout_date: -1 });

export const Payout = model<IPayout>("Payout", payoutSchema, "payouts");

/**
 * Legacy invoice numbers.
 *
 * Bills once carried their own global sequence, allocated here. They now print
 * the order's own number scoped by the shop's code (see services/bill.service.ts),
 * which is stable by construction and needs no allocation — so nothing writes
 * to this collection any more. The model is kept only so deleting an order
 * still clears the row a pre-existing bill left behind.
 */
export interface IInvoice {
  _id: string;
  order_id: string;
  invoice_no: number;
  created_at?: Date;
  updated_at?: Date;
}

const invoiceSchema = new Schema<IInvoice>(
  {
    _id: uuidId,
    order_id: { type: String, ref: "Order", required: true, unique: true },
    invoice_no: { type: Number, required: true, unique: true },
  },
  schemaOptions(),
);

export const Invoice = model<IInvoice>("Invoice", invoiceSchema, "invoices");

/** Atomic sequence generator ($inc + upsert), for any counter that needs one. */
export interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false, timestamps: false },
);

export const Counter = model<ICounter>("Counter", counterSchema, "counters");

export async function nextSequence(name: string): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return doc!.seq;
}
