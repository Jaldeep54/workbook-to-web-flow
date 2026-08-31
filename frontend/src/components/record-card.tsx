import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The phone and small-tablet form of a record table.
 *
 * A row of ten columns cannot be read on a 390px screen, and horizontal
 * scrolling hides exactly the things these screens exist to do — reading a
 * balance, typing in what a shopkeeper handed over. So below `md` the same
 * records are rendered as stacked cards: identity and status on top, the
 * fields beneath as label/value pairs that wrap instead of overflowing.
 *
 * Both forms are driven by the same page state — the same filters, the same
 * page slice, the same mutations — so nothing can disagree between them. Only
 * the markup differs, and only one of the two is ever in the layout:
 *
 *   <div className="hidden md:block"> …table… </div>
 *   <RecordCards className="md:hidden"> …cards… </RecordCards>
 */
export function RecordCards({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-border", className)}>{children}</div>;
}

/**
 * One record. `title`/`subtitle` name it, `badge` carries the status, and
 * `children` are the `RecordField`s.
 */
export function RecordCard({
  title,
  subtitle,
  badge,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-words">{title}</p>
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      {children && <dl className="space-y-2">{children}</dl>}
      {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
    </div>
  );
}

/**
 * A label/value pair inside a card. `align` controls how the value sits
 * against the label: `end` for figures that should line up down the card,
 * `stretch` for a control that should take the width it needs.
 */
export function RecordField({
  label,
  children,
  align = "end",
}: {
  label: string;
  children: ReactNode;
  align?: "end" | "stretch";
}) {
  return (
    <div
      className={cn(
        "flex gap-3",
        align === "end" ? "items-center justify-between" : "flex-col items-stretch gap-1",
      )}
    >
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-sm", align === "end" ? "text-right" : "w-full")}>
        {children}
      </dd>
    </div>
  );
}
