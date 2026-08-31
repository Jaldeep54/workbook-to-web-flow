import { logger } from "../config/logger.js";
import { Payment } from "../models/order.model.js";

/**
 * One-off data repairs that must run before the app trusts a field.
 *
 * These are written to be idempotent and to match only the rows that still
 * need them, so `npm run seed` stays safe to re-run and costs nothing once the
 * data is already in shape.
 */

/**
 * Payments predate `amount_received`: a row recorded a status and nothing
 * else, so "Received" means the whole bill arrived and anything else means
 * none of it has. Fills the field in on that basis, so balances, part payments
 * and the derived status all start from what the workbook actually recorded.
 *
 * A legacy row marked "Partial" is moved to "Pending", not left as it was:
 * before this field existed, "Partial" could not say *how much* had come in,
 * so there is no instalment to preserve. Whoever collected the money types the
 * real figure in, and the status follows from it.
 *
 * Until this has run, an old "Received" row reads as fully settled while
 * showing its whole amount still outstanding — the two figures the screen puts
 * side by side disagree. That is the reason to run it before trusting the
 * Payments screen on an existing database.
 */
export async function backfillPaymentAmountReceived(): Promise<number> {
  const missing = { amount_received: { $exists: false } } as const;

  const [settled, unpaid] = await Promise.all([
    Payment.updateMany({ ...missing, status: "Received" }, [
      { $set: { amount_received: "$amount" } },
    ]),
    Payment.updateMany({ ...missing, status: { $ne: "Received" } }, [
      { $set: { amount_received: 0, status: "Pending" } },
    ]),
  ]);

  const total = settled.modifiedCount + unpaid.modifiedCount;
  if (total > 0) {
    logger.info(
      `Backfilled amount_received on ${total} payment(s) — ${settled.modifiedCount} settled in full, ${unpaid.modifiedCount} with nothing collected yet`,
    );
  }
  return total;
}
