import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, KeyRound, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { ShopAreaFilter, ShopFilter, shopLabel } from "@/components/filter-bar";
import { SearchInput } from "@/components/search-input";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/hooks/usePermissions";
import { dateLabel, inr, num, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  teamApi,
  type ActivityFilters,
  type ActivityRow,
  type ActivityType,
  type TeamKind,
} from "@/services/klinzo.service";

/**
 * Manager Dashboard and Salesperson Dashboard — one component, two teams.
 *
 * The list shows every member with the shops they work; tapping one opens
 * their dashboard: what they did (orders taken, deliveries, and for managers
 * collections and change money), each filterable by date / month / year /
 * shop / area with a running total, plus the shops they work and "Give
 * Access" to more.
 */
const TEAM = {
  managers: {
    title: "Manager Dashboard",
    singular: "Manager",
    resource: "manager_dashboard",
    tabs: ["orders", "deliveries", "collections", "change_money", "shops"] as const,
  },
  salespersons: {
    title: "Salesperson Dashboard",
    singular: "Salesperson",
    resource: "salesperson_dashboard",
    tabs: ["orders", "deliveries", "shops"] as const,
  },
};

type Tab = ActivityType | "shops";

const TAB_LABEL: Record<Tab, string> = {
  orders: "Orders",
  deliveries: "Deliveries",
  collections: "Collections",
  change_money: "Change money",
  shops: "Shops",
};

export function TeamDashboard({
  kind,
  userId,
  onSelect,
}: {
  kind: TeamKind;
  userId?: string;
  onSelect: (userId: string | undefined) => void;
}) {
  return userId ? (
    <MemberDashboard kind={kind} userId={userId} onBack={() => onSelect(undefined)} />
  ) : (
    <MemberList kind={kind} onSelect={onSelect} />
  );
}

/* -------------------------------------------------------------------- list */

function MemberList({ kind, onSelect }: { kind: TeamKind; onSelect: (id: string) => void }) {
  const team = TEAM[kind];
  const members = useQuery({ queryKey: ["team", kind], queryFn: () => teamApi.list(kind) });
  const rows = members.data ?? [];

  return (
    <>
      <PageHeader
        title={team.title}
        description={`Every ${team.singular.toLowerCase()} and the shops they work — tap a name for their dashboard`}
      />
      {members.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {members.error && (
        <p className="text-sm text-destructive">{(members.error as Error).message}</p>
      )}
      {!members.isLoading && rows.length === 0 && (
        <div className="surface-card p-6 text-center text-sm text-muted-foreground">
          No {team.singular.toLowerCase()}s yet. In Admin → Roles &amp; permissions, set a
          role&apos;s field role to “{team.singular}”, then add active users to it.
        </div>
      )}

      <div className="space-y-2 md:hidden">
        {rows.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            className="surface-card flex w-full items-start gap-3 p-4 text-left active:bg-secondary"
          >
            <span className="num w-6 shrink-0 pt-0.5 text-xs text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{m.full_name}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {m.shop_count} shop{m.shop_count === 1 ? "" : "s"}
                {m.shop_count > 0 && ": "}
                {m.shops
                  .slice(0, 4)
                  .map((s) => s.shop_name)
                  .join(", ")}
                {m.shop_count > 4 && ` +${m.shop_count - 4} more`}
              </span>
            </span>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="surface-card hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">S.No</TableHead>
                <TableHead>{team.singular} Name</TableHead>
                <TableHead>List of Shops</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m, i) => (
                <TableRow key={m.id}>
                  <TableCell className="num">{i + 1}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => onSelect(m.id)}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {m.full_name}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-xl">
                    {m.shop_count === 0 ? (
                      <span className="text-muted-foreground">No shops</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {m.shops.slice(0, 8).map((s) => (
                          <Badge key={s.id} variant="secondary" className="font-normal">
                            {s.shop_name}
                          </Badge>
                        ))}
                        {m.shop_count > 8 && (
                          <Badge variant="outline">+{m.shop_count - 8} more</Badge>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- dashboard */

function MemberDashboard({
  kind,
  userId,
  onBack,
}: {
  kind: TeamKind;
  userId: string;
  onBack: () => void;
}) {
  const team = TEAM[kind];
  const [tab, setTab] = useState<Tab>("orders");
  const member = useQuery({
    queryKey: ["team_member", kind, userId],
    queryFn: () => teamApi.member(kind, userId),
  });

  return (
    <>
      <div className="mb-2">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ChevronLeft className="size-4" /> All {team.singular.toLowerCase()}s
        </Button>
      </div>
      <PageHeader
        title={member.data?.full_name ?? "…"}
        description={`${team.singular} dashboard`}
      />
      {member.error && (
        <p className="mb-4 text-sm text-destructive">{(member.error as Error).message}</p>
      )}

      <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="inline-flex gap-1 rounded-xl border border-border bg-card p-1">
          {team.tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                tab === t
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {tab === "shops" ? (
        <MemberShops kind={kind} userId={userId} name={member.data?.full_name ?? ""} />
      ) : (
        <ActivityList kind={kind} userId={userId} type={tab} />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- activity */

type PeriodMode = "all" | "date" | "month" | "year";

function yearOptions(): string[] {
  const now = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => String(now - i));
}

function ActivityList({
  kind,
  userId,
  type,
}: {
  kind: TeamKind;
  userId: string;
  type: ActivityType;
}) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canUpdate = can(TEAM[kind].resource, "update");

  const [mode, setMode] = useState<PeriodMode>("month");
  const [date, setDate] = useState(todayISO());
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [year, setYear] = useState(todayISO().slice(0, 4));
  const [area, setArea] = useState("all");
  const [shop, setShop] = useState("all");

  const filters: ActivityFilters = {
    ...(mode === "date" && date ? { date } : {}),
    ...(mode === "month" && month ? { month } : {}),
    ...(mode === "year" && year ? { year } : {}),
    ...(shop !== "all" ? { shopId: shop } : area !== "all" ? { areaId: area } : {}),
  };

  const activity = useQuery({
    queryKey: ["team_activity", kind, userId, type, filters],
    queryFn: () => teamApi.activity(kind, userId, type, filters),
  });
  const rows = activity.data?.rows ?? [];
  const summary = activity.data?.summary;

  const markPaid = useMutation({
    mutationFn: ({ id, paid }: { id: string; paid: boolean }) =>
      teamApi.setChangeMoneyPaid(id, paid),
    onSuccess: (_r, vars) => {
      toast.success(vars.paid ? "Marked paid — deducted from cash in hand" : "Marked not paid");
      void qc.invalidateQueries({ queryKey: ["team_activity"] });
      void qc.invalidateQueries({ queryKey: ["cash_position_summary"] });
      void qc.invalidateQueries({ queryKey: ["field_collections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const periodLabel =
    mode === "all"
      ? "all time"
      : mode === "date"
        ? dateLabel(date)
        : mode === "month"
          ? new Date(`${month}-01`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
          : year;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select value={mode} onValueChange={(v) => setMode(v as PeriodMode)}>
          <SelectTrigger className="w-full bg-card sm:w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="date">Date</SelectItem>
            <SelectItem value="month">Month</SelectItem>
            <SelectItem value="year">Year</SelectItem>
          </SelectContent>
        </Select>
        {mode === "date" && (
          <Input
            type="date"
            className="bg-card sm:w-[170px]"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
        {mode === "month" && (
          <Input
            type="month"
            className="bg-card sm:w-[170px]"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        )}
        {mode === "year" && (
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-full bg-card sm:w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions().map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {mode === "all" && <span className="hidden sm:block" />}
        <ShopAreaFilter
          value={area}
          onChange={(v) => {
            setArea(v);
            setShop("all");
          }}
        />
        <ShopFilter value={shop} onChange={setShop} areaId={area !== "all" ? area : null} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={TAB_LABEL[type]} value={num(summary?.count ?? 0)} sub={periodLabel} />
        <StatCard
          label={
            type === "orders"
              ? "Order value"
              : type === "deliveries"
                ? "Bill amount"
                : type === "collections"
                  ? "Collected"
                  : "Change money"
          }
          value={inr(summary?.total ?? 0, 2)}
          tone="accent"
        />
        {summary?.qty !== undefined && <StatCard label="Quantity" value={num(summary.qty)} />}
        {type === "collections" && (
          <StatCard label="Change money" value={inr(summary?.change_money ?? 0, 2)} />
        )}
        {type === "change_money" && (
          <>
            <StatCard label="Paid" value={inr(summary?.paid ?? 0, 2)} tone="positive" />
            <StatCard label="Not paid" value={inr(summary?.unpaid ?? 0, 2)} tone="negative" />
          </>
        )}
      </div>

      {activity.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {activity.error && (
        <p className="text-sm text-destructive">{(activity.error as Error).message}</p>
      )}
      {!activity.isLoading && rows.length === 0 && (
        <div className="surface-card p-6 text-center text-sm text-muted-foreground">
          Nothing for {periodLabel}.
        </div>
      )}

      {rows.length > 0 && (
        <div className="surface-card divide-y divide-border">
          {rows.map((r) => (
            <ActivityItem
              key={r.id}
              row={r}
              type={type}
              action={
                type === "change_money" && canUpdate ? (
                  r.change_money_paid ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={markPaid.isPending}
                      onClick={() => markPaid.mutate({ id: r.id, paid: false })}
                    >
                      <Undo2 className="size-4" /> Undo
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={markPaid.isPending}
                      onClick={() => markPaid.mutate({ id: r.id, paid: true })}
                    >
                      <CheckCircle2 className="size-4" /> Mark paid
                    </Button>
                  )
                ) : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityItem({
  row,
  type,
  action,
}: {
  row: ActivityRow;
  type: ActivityType;
  action: React.ReactNode;
}) {
  const shop = row.shop ? shopLabel(row.shop.shop_name, row.shop.label_name) : "—";
  const amount = type === "change_money" ? (row.change_money ?? 0) : row.amount;

  return (
    <div className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium break-words">{shop}</p>
        <p className="text-xs text-muted-foreground">
          {dateLabel(row.date)}
          {row.shop?.area_name && ` · ${row.shop.area_name}`}
          {row.order_no != null && ` · Order #${row.order_no}`}
        </p>
        {row.products && <p className="text-sm break-words">{row.products}</p>}
        {type === "orders" && row.status && (
          <p className="text-xs text-muted-foreground">
            {row.status} · delivery {dateLabel(row.delivery_date)}
          </p>
        )}
        {type === "collections" && (row.change_money ?? 0) > 0 && (
          <p className="num text-xs text-muted-foreground">
            Change money {inr(row.change_money, 2)}
          </p>
        )}
        {type === "change_money" && (
          <p className="text-xs">
            {row.change_money_paid ? (
              <span className="text-success">Paid {dateLabel(row.change_money_paid_date)}</span>
            ) : (
              <span className="text-destructive">Not paid</span>
            )}
            <span className="text-muted-foreground"> · collected {inr(row.amount, 2)}</span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <p className="num font-semibold">{inr(amount, 2)}</p>
        {row.qty !== undefined && (
          <p className="num text-xs text-muted-foreground">Qty {num(row.qty)}</p>
        )}
        {action}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- shops */

function MemberShops({ kind, userId, name }: { kind: TeamKind; userId: string; name: string }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canUpdate = can(TEAM[kind].resource, "update");
  const [area, setArea] = useState("all");
  const [giving, setGiving] = useState(false);

  const shops = useQuery({
    queryKey: ["team_shops", kind, userId, area],
    queryFn: () => teamApi.shops(kind, userId, { areaId: area !== "all" ? area : undefined }),
  });

  const invalidate = () => {
    for (const key of ["team_shops", "team", "field_shops", "shops"]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const revoke = useMutation({
    mutationFn: (shopId: string) => teamApi.revoke(kind, userId, shopId),
    onSuccess: () => {
      toast.success("Access removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = shops.data ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <ShopAreaFilter value={area} onChange={setArea} />
        {canUpdate && (
          <Button onClick={() => setGiving(true)}>
            <KeyRound className="size-4" /> Give Access
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {rows.length} shop{rows.length === 1 ? "" : "s"} handled by {name || "them"}
      </p>

      {shops.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!shops.isLoading && rows.length === 0 && (
        <div className="surface-card p-6 text-center text-sm text-muted-foreground">
          No shops here yet{canUpdate ? " — use Give Access to add some." : "."}
        </div>
      )}
      {rows.length > 0 && (
        <div className="surface-card divide-y divide-border">
          {rows.map((s, i) => (
            <div key={s.id} className="flex items-start gap-3 p-4">
              <span className="num w-6 shrink-0 pt-0.5 text-xs text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{shopLabel(s.shop_name, s.label_name)}</p>
                <p className="text-xs text-muted-foreground">
                  {s.area_name ?? "No area"}
                  {kind === "managers" && s.salesperson && ` · Salesperson ${s.salesperson}`}
                  {kind === "salespersons" && s.handled_by && ` · Manager ${s.handled_by}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Badge variant={s.assignment === "primary" ? "default" : "secondary"}>
                  {s.assignment === "primary"
                    ? kind === "managers"
                      ? "Handled by"
                      : "Salesperson"
                    : "Access"}
                </Badge>
                {canUpdate && !(kind === "managers" && s.assignment === "primary") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Remove access to ${s.shop_name}`}
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(s.id)}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <GiveAccessDialog
        kind={kind}
        userId={userId}
        name={name}
        open={giving}
        onOpenChange={setGiving}
        onDone={invalidate}
      />
    </div>
  );
}

function GiveAccessDialog({
  kind,
  userId,
  name,
  open,
  onOpenChange,
  onDone,
}: {
  kind: TeamKind;
  userId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [area, setArea] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const all = useQuery({
    queryKey: ["team_shops", kind, userId, "all", area],
    queryFn: () =>
      teamApi.shops(kind, userId, { areaId: area !== "all" ? area : undefined, assigned: false }),
    enabled: open,
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (all.data ?? []).filter(
      (s) =>
        !q ||
        s.shop_name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.label_name ?? "").toLowerCase().includes(q),
    );
  }, [all.data, search]);
  const grantable = visible.filter((s) => !s.assignment);
  const allShownSelected = grantable.length > 0 && grantable.every((s) => selected.has(s.id));

  const close = () => {
    setSelected(new Set());
    setSearch("");
    onOpenChange(false);
  };

  const grant = useMutation({
    mutationFn: (payload: { shop_ids?: string[]; all?: boolean; area_id?: string | null }) =>
      teamApi.grant(kind, userId, payload),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-lg flex-col p-4 sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle>Give access</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Choose shops {name || "this person"} should also work.
          </p>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ShopAreaFilter
            value={area}
            onChange={(v) => {
              setArea(v);
              setSelected(new Set());
            }}
          />
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search shops…"
            className="sm:w-full"
          />
        </div>
        {grantable.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={allShownSelected}
              onCheckedChange={(checked) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const s of grantable) {
                    if (checked) next.add(s.id);
                    else next.delete(s.id);
                  }
                  return next;
                })
              }
            />
            Select all shown ({grantable.length})
          </label>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {all.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
          {!all.isLoading && visible.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No shops match.</p>
          )}
          <div className="divide-y divide-border">
            {visible.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-3",
                  s.assignment && "cursor-default opacity-60",
                )}
              >
                <Checkbox
                  checked={!!s.assignment || selected.has(s.id)}
                  disabled={!!s.assignment}
                  onCheckedChange={(checked) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium break-words">
                    {shopLabel(s.shop_name, s.label_name)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {s.area_name ?? "No area"}
                    {s.assignment && " · already has access"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            disabled={grant.isPending}
            onClick={() => {
              const scope = area !== "all" ? "every shop in this area" : "every active shop";
              if (window.confirm(`Give ${name || "them"} access to ${scope}?`)) {
                grant.mutate({ all: true, area_id: area !== "all" ? area : null });
              }
            }}
          >
            {area !== "all" ? "Give Access to All in Area" : "Give Access to All"}
          </Button>
          <Button
            disabled={grant.isPending || selected.size === 0}
            onClick={() => grant.mutate({ shop_ids: Array.from(selected) })}
          >
            Give access ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
