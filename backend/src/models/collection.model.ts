import { Schema, model } from "mongoose";

import { monthKey } from "../utils/date.js";
import { ISO_DATE_MATCH, schemaOptions, uuidId } from "./base.js";

/**
 * One cash collection from a shop — the "Make Payment" action in Field
 * Operations.
 *
 * A shop hands over one sum against however many deliveries it still owes on,
 * so the collection is the ledger row and `allocations` record how that sum
 * was spread across the shop's payments, oldest delivery first (see
 * services/field-ops.service.ts). The payments' own `amount_received` is what
 * every report reads; this row is the audit trail behind it, and what the
 * Manager Dashboard lists as "Payment Collections".
 *
 * `change_money` is cash the collector handed back to the shop out of the
 * business's money. It leaves cash in hand only once a manager marks it paid
 * (`change_money_paid`) on the Manager Dashboard — see cash-position.service.
 */
export type CollectionAllocation = { payment_id: string; order_id: string; amount: number };

export interface ICollection {
  _id: string;
  shop_id: string;
  collection_date: string;
  month: string | null;
  amount: number;
  change_money: number;
  collected_by: string | null;
  collected_by_user_id: string | null;
  recorded_by_user_id: string | null;
  allocations: CollectionAllocation[];
  change_money_paid: boolean;
  change_money_paid_date: string | null;
  change_money_paid_by: string | null;
  created_at?: Date;
  updated_at?: Date;
}

const allocationSchema = new Schema<CollectionAllocation>(
  {
    payment_id: { type: String, ref: "Payment", required: true },
    order_id: { type: String, ref: "Order", required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const collectionSchema = new Schema<ICollection>(
  {
    _id: uuidId,
    shop_id: { type: String, ref: "Shop", required: true },
    collection_date: { type: String, required: true, match: ISO_DATE_MATCH },
    month: { type: String, default: null, match: ISO_DATE_MATCH },
    amount: { type: Number, required: true, min: 0 },
    change_money: { type: Number, default: 0, min: 0 },
    collected_by: { type: String, default: null, trim: true, maxlength: 120 },
    collected_by_user_id: { type: String, ref: "User", default: null },
    recorded_by_user_id: { type: String, ref: "User", default: null },
    allocations: { type: [allocationSchema], default: [] },
    change_money_paid: { type: Boolean, default: false },
    change_money_paid_date: { type: String, default: null, match: ISO_DATE_MATCH },
    change_money_paid_by: { type: String, default: null, trim: true },
  },
  schemaOptions(),
);

collectionSchema.index({ shop_id: 1, collection_date: -1 });
collectionSchema.index({ collected_by_user_id: 1, collection_date: -1 });
collectionSchema.index({ change_money_paid: 1 });

collectionSchema.pre("validate", function assignMonth(next) {
  this.month = monthKey(this.collection_date);
  next();
});

export const Collection = model<ICollection>("Collection", collectionSchema, "collections");
