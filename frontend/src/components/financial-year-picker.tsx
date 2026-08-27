import { useQuery } from "@tanstack/react-query";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { availableMonthsQuery } from "@/lib/queries";
import {
  currentFinancialYear,
  defaultMonthForFinancialYear,
  financialYearLabel,
  financialYearsFromDates,
  monthKey,
  monthsInFinancialYear,
} from "@/lib/domain";

/**
 * India-style Financial Year picker (Apr -> Mar). Pair with `MonthPicker`'s
 * `financialYear` prop to scope the month dropdown down to the selected FY.
 *
 * The option list is built from every month that has data anywhere in the
 * business, not just from the rows the calling page currently has loaded —
 * otherwise the list would collapse as the page's own filters narrow, and an
 * FY with data could not be reached once you had navigated away from it.
 */
export function FinancialYearPicker({
  value,
  onChange,
  dates = [],
}: {
  value: string;
  /**
   * Receives the chosen FY and the month the page should move to — the most
   * recent month of that FY that actually holds data, so picking an FY never
   * lands on an empty month while the year has records elsewhere.
   */
  onChange: (fy: string, suggestedMonth: string) => void;
  /** Extra dates (e.g. from loaded data) so financial years with data always appear. */
  dates?: Array<string | null | undefined>;
}) {
  const { data: monthsWithData = [] } = useQuery(availableMonthsQuery);

  // `value` is already an FY key, so it is added as one. Passing it through
  // the date path would read "2025" as 1 Jan 2025 — which belongs to FY
  // 2024-25 — and the selected year would be missing from its own list,
  // leaving the trigger blank.
  const years = financialYearsFromDates([...dates, ...monthsWithData], [value]);

  const suggestMonth = (fy: string) => {
    // The current FY opens on the current month, as it always has.
    if (fy === currentFinancialYear()) return defaultMonthForFinancialYear(fy);

    const inFy = new Set(monthsInFinancialYear(fy));
    // The page's own rows are the better guide when it has them (a shop's
    // history, say); the business-wide month list is the fallback.
    const fromDates = dates
      .filter((d): d is string => !!d)
      .map(monthKey)
      .filter((m) => inFy.has(m));
    const candidates = fromDates.length > 0 ? fromDates : monthsWithData.filter((m) => inFy.has(m));

    if (candidates.length === 0) return defaultMonthForFinancialYear(fy);
    return candidates.reduce((latest, m) => (m > latest ? m : latest));
  };

  return (
    <Select value={value} onValueChange={(fy) => onChange(fy, suggestMonth(fy))}>
      <SelectTrigger className="w-[130px] max-w-full bg-card">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((fy) => (
          <SelectItem key={fy} value={fy}>
            {financialYearLabel(fy)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
