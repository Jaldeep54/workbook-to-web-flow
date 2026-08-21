import { randomUUID } from "node:crypto";


/**
 * Documents are keyed by UUID strings rather than ObjectIds.
 *
 * The data this app migrates from Postgres/Supabase is already keyed by UUID
 * and cross-referenced by it (orders -> shops, deliveries -> orders, ...), so
 * keeping UUID `_id`s makes the migration relationship-preserving and
 * re-runnable (upsert by the same id), and keeps every id in API responses
 * identical to the ones the app used before.
 */
export const uuidId = {
  type: String,
  default: (): string => randomUUID(),
};

/**
 * Shared schema options: `id` in JSON instead of `_id`, no `__v`, and
 * created_at/updated_at maintained by Mongoose.
 *
 * Domain collections keep the workbook's snake_case field names (shop_name,
 * total_qty, order_lines...) end to end — database, API and UI — so the
 * business data has a single vocabulary and the migration maps one-to-one.
 * Platform collections added by this rewrite (users, roles, permissions) use
 * camelCase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function schemaOptions(extra: Record<string, unknown> = {}): any {
  return {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    minimize: false,
    toJSON: {
      virtuals: true,
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
    ...extra,
  };
}

/** camelCase timestamps for the platform collections, hash always stripped. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function platformSchemaOptions(extra: Record<string, unknown> = {}): any {
  return {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.passwordHash;
        return ret;
      },
    },
    toObject: { virtuals: true },
    ...extra,
  };
}

/** Regex every `YYYY-MM-DD` calendar column validates against. */
export const ISO_DATE_MATCH = /^\d{4}-\d{2}-\d{2}$/;

/** Strips Mongo's `_id` in favour of the `id` the API exposes. */
export function withId<T extends { _id: string }>(row: T): Omit<T, "_id"> & { id: string } {
  const { _id, ...rest } = row;
  return { id: _id, ...rest };
}
