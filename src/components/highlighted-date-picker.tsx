import { CalendarIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Local-date-safe ISO conversion — mirrors the pattern already used on Orders/Delivery Sheet. */
function toISODate(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * Single-date picker (wraps ui/calendar.tsx) that marks a set of dates with a
 * small dot so it's clear at a glance which days have data — e.g. dates with
 * orders on Orders, or deliveries due on the Delivery Sheet.
 */
export function HighlightedDatePicker({
  value,
  onChange,
  highlightedDates = [],
  placeholder = "Any date",
  allowClear = true,
  className,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
  /** ISO dates (YYYY-MM-DD) to mark with a dot in the calendar. */
  highlightedDates?: string[];
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
}) {
  const highlighted = highlightedDates.map((d) => new Date(`${d}T00:00:00`));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("justify-start bg-card font-normal", className)}>
          <CalendarIcon className="size-4" />
          {value ? dateLabel(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? new Date(`${value}T00:00:00`) : undefined}
          onSelect={(d) => d && onChange(toISODate(d))}
          modifiers={{ highlighted }}
          modifiersClassNames={{
            highlighted:
              "relative after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
          }}
          initialFocus
          className="pointer-events-auto p-3"
        />
        {allowClear && value && (
          <Button
            variant="ghost"
            size="sm"
            className="m-2 mt-0 w-[calc(100%-1rem)]"
            onClick={() => onChange(null)}
          >
            <X className="size-3.5" /> Clear date
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
