import type { Response } from "express";

/**
 * One response shape for the whole API:
 *   success -> { success: true, data, meta? }
 *   failure -> { success: false, error: { code, message, details? } }
 * The frontend's api client unwraps `data` and throws on `error`, so every
 * endpoint must go through these helpers.
 */
export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.status(201).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function noContent(res: Response) {
  return res.status(204).send();
}

export function paginated<T>(res: Response, items: T[], meta: PaginationMeta) {
  return res.status(200).json({ success: true, data: items, meta });
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}
