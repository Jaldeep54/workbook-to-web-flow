import { z } from "zod";

/** `YYYY-MM-DD` calendar date, the storage format for every date field. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), "Invalid date");

/** A month bucket — always the first of the month. */
export const monthString = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, "Expected a month in YYYY-MM-01 form");

export const idParam = z.object({ id: z.string().min(1, "id is required") });

export const idString = z.string().min(1);

export const nullableString = (max = 255) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? undefined)));

export const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z.string().max(60).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

/** `?shopId=all` is how the UI expresses "no shop filter". */
export const shopFilter = z
  .string()
  .optional()
  .transform((v) => (!v || v === "all" ? undefined : v));

export const areaFilter = shopFilter;

export const booleanFlag = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");
