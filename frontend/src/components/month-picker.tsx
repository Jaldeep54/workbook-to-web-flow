import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { availableMonthsQuery } from "@/lib/queries";
import { currentMonth, monthLabel, monthsInFinancialYear, recentMonths } from "@/lib/domain";

export function MonthPicker({
  value,
  onChange,
  financialYear,
}: {
  value: string;
  onChange: (m: string) => void;
  /** When set, restricts the dropdown to the 12 months (Apr -> Mar) of this financial year. */
  financialYear?: string;
}) {
  const { data } = useQuery(availableMonthsQuery);
  let months = Array.from(new Set([...(data ?? []), currentMonth(), value, ...recentMonths(12)]))
    .filter(Boolean)
    .sort((a, b) => (a < b ? 1 : -1));

  if (financialYear) {
    const fyMonths = monthsInFinancialYear(financialYear);
    const fyMonthSet = new Set(fyMonths);
    // Every month of the FY is selectable (even ones without data yet), plus
    // any data-backed months that also fall in this FY.
    months = Array.from(new Set([...fyMonths, ...months.filter((m) => fyMonthSet.has(m))])).sort(
      (a, b) => (a < b ? 1 : -1),
    );
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full bg-card sm:w-[190px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {months.map((m) => (
          <SelectItem key={m} value={m}>
            {monthLabel(m)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
