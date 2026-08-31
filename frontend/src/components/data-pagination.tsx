import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Paging for the app's record tables.
 *
 * Every list here is already narrowed by the server to one month (and often
 * one shop or area) before it reaches the browser, so the page slice is taken
 * client-side. That is deliberate, not a shortcut: the stat cards above each
 * table, the totals rows and the CSV export all describe the *whole* filtered
 * set, and they would start lying about it the moment the browser only held
 * the visible page.
 */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type Pagination<T> = {
  /** The rows to render for the current page. */
  pageRows: T[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** 1-based index of the first row on this page; 0 when there are none. */
  firstRow: number;
  lastRow: number;
};

/**
 * Slices `rows` into pages.
 *
 * `resetKey` is whatever combination of filters produced `rows` — change it
 * and paging returns to page 1, so narrowing a filter never leaves the user
 * staring at an empty page 7. Independently of that, the page is clamped to
 * the last one that still has rows, which covers a list shrinking underneath
 * the user (a delete, a refetch) without a filter having changed at all.
 */
export function usePagination<T>(
  rows: T[],
  options: { pageSize?: number; resetKey?: unknown } = {},
): Pagination<T> {
  const [pageSize, setPageSize] = useState<number>(options.pageSize ?? DEFAULT_PAGE_SIZE);
  const [requestedPage, setRequestedPage] = useState(1);

  const resetKey = options.resetKey;
  useEffect(() => {
    setRequestedPage(1);
  }, [resetKey, pageSize]);

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(requestedPage, totalPages);

  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  return {
    pageRows,
    page,
    pageSize,
    totalRows,
    totalPages,
    setPage: (next: number) => setRequestedPage(Math.min(Math.max(1, next), totalPages)),
    setPageSize,
    firstRow: totalRows === 0 ? 0 : (page - 1) * pageSize + 1,
    lastRow: Math.min(page * pageSize, totalRows),
  };
}

/**
 * The page numbers to offer: always the first and last, always the current one
 * and its neighbours, with an ellipsis standing in for whatever that skips.
 */
function pageItems(page: number, totalPages: number): Array<number | "gap"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const items: Array<number | "gap"> = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(totalPages - 1, page + 1);

  if (from > 2) items.push("gap");
  for (let p = from; p <= to; p += 1) items.push(p);
  if (to < totalPages - 1) items.push("gap");

  items.push(totalPages);
  return items;
}

/**
 * The bar under a table: what is on screen, how many rows to show at a time,
 * and the page controls. Renders the row count on its own when everything
 * already fits — a single page of results needs no navigation.
 */
export function DataPagination<T>({
  pagination,
  /** Plural noun for the row count, e.g. "orders". */
  noun = "rows",
  className,
}: {
  pagination: Pagination<T>;
  noun?: string;
  className?: string;
}) {
  const { page, pageSize, totalPages, totalRows, firstRow, lastRow, setPage, setPageSize } =
    pagination;

  if (totalRows === 0) return null;

  const singlePage = totalPages === 1;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-xs text-muted-foreground">
        Showing <span className="num font-medium text-foreground">{num(firstRow)}</span>–
        <span className="num font-medium text-foreground">{num(lastRow)}</span> of{" "}
        <span className="num font-medium text-foreground">{num(totalRows)}</span> {noun}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[74px] bg-card" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!singlePage && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="First page"
              disabled={page === 1}
              onClick={() => setPage(1)}
            >
              <ChevronsLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Previous page"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>

            {pageItems(page, totalPages).map((item, i) =>
              item === "gap" ? (
                <span key={`gap-${i}`} aria-hidden className="px-1 text-xs text-muted-foreground">
                  …
                </span>
              ) : (
                <Button
                  key={item}
                  variant={item === page ? "default" : "ghost"}
                  size="icon"
                  className="num size-8 text-xs"
                  aria-label={`Page ${item}`}
                  aria-current={item === page ? "page" : undefined}
                  onClick={() => setPage(item)}
                >
                  {item}
                </Button>
              ),
            )}

            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Next page"
              disabled={page === totalPages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Last page"
              disabled={page === totalPages}
              onClick={() => setPage(totalPages)}
            >
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
