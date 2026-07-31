import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { availableMonthsQuery } from "@/lib/queries";
import { currentMonth, monthLabel, recentMonths } from "@/lib/domain";

export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const { data } = useQuery(availableMonthsQuery);
  const months = Array.from(new Set([...(data ?? []), currentMonth(), value, ...recentMonths(12)]))
    .filter(Boolean)
    .sort((a, b) => (a < b ? 1 : -1));

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[190px] bg-card">
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