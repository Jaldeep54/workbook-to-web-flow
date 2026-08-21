import { ApiError } from "./api-error.js";

export type ListQuery = {
  page: number;
  limit: number;
  skip: number;
  search?: string;
  sort: Record<string, 1 | -1>;
};

const MAX_LIMIT = 500;

/** Escapes a user-supplied string so it can be used safely inside a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive "contains" matcher for search endpoints. */
export function searchRegex(value: string): RegExp {
  return new RegExp(escapeRegex(value.trim()), "i");
}

/**
 * Shared parser for `?page=&limit=&search=&sortBy=&sortOrder=` used by every
 * list endpoint, so pagination and sorting behave identically across the API.
 * `allowedSortFields` is a whitelist — an unknown field is rejected rather
 * than silently ignored, and it keeps arbitrary field probing out of queries.
 */
export function parseListQuery(
  query: Record<string, unknown>,
  allowedSortFields: string[],
  defaults: { sortBy?: string; sortOrder?: "asc" | "desc"; limit?: number } = {},
): ListQuery {
  const page = Math.max(1, Number(query.page) || 1);
  const rawLimit = Number(query.limit) || defaults.limit || 50;
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));

  const sortBy = String(query.sortBy ?? defaults.sortBy ?? allowedSortFields[0] ?? "createdAt");
  if (!allowedSortFields.includes(sortBy)) {
    throw ApiError.badRequest(
      `Cannot sort by "${sortBy}". Allowed: ${allowedSortFields.join(", ")}`,
    );
  }
  const sortOrderRaw = String(query.sortOrder ?? defaults.sortOrder ?? "asc").toLowerCase();
  if (!["asc", "desc"].includes(sortOrderRaw)) {
    throw ApiError.badRequest('sortOrder must be "asc" or "desc"');
  }

  const search = typeof query.search === "string" && query.search.trim() ? query.search.trim() : undefined;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    search,
    sort: { [sortBy]: sortOrderRaw === "desc" ? -1 : 1 },
  };
}
