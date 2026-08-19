import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { financialYearLabel, financialYearsFromDates } from "@/lib/domain";

/**
 * India-style Financial Year picker (Apr -> Mar). Pair with `MonthPicker`'s
 * `financialYear` prop to scope the month dropdown down to the selected FY.
 */
export function FinancialYearPicker({
  value,
  onChange,
  dates = [],
}: {
  value: string;
  onChange: (fy: string) => void;
  /** Extra dates (e.g. from loaded data) so financial years with data always appear. */
  dates?: Array<string | null | undefined>;
}) {
  const years = financialYearsFromDates([...dates, value]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[130px] bg-card">
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
