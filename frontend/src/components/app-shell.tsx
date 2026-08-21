import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Boxes,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Receipt,
  Settings,
  Shield,
  Store,
  Truck,
  ClipboardList,
  CalendarDays,
  Lightbulb,
  Menu,
  MapPin,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/hooks/useAuth";
import { RESOURCES, usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Navigation is permission-driven: each entry declares the permission it needs
 * and is hidden when the signed-in user doesn't hold it. A "Marketing" user
 * simply never sees Payments, Cash Position or Administration — and if they
 * navigate there anyway, the page guard and then the API both refuse.
 */
const NAV: Array<{
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  resource: string;
  section?: string;
}> = [
  { to: "/", label: "Overview", icon: LayoutDashboard, resource: RESOURCES.dashboard },
  { to: "/shops", label: "Shops", icon: Store, resource: RESOURCES.shops },
  { to: "/shops/map", label: "Shops on Map", icon: MapPin, resource: RESOURCES.shops },
  {
    to: "/sku-opportunity",
    label: "SKU opportunity",
    icon: Lightbulb,
    resource: RESOURCES.skuOpportunity,
  },
  { to: "/orders", label: "Orders", icon: ClipboardList, resource: RESOURCES.orders },
  {
    to: "/delivery-sheet",
    label: "Delivery sheet",
    icon: CalendarDays,
    resource: RESOURCES.orders,
  },
  { to: "/deliveries", label: "Deliveries", icon: Truck, resource: RESOURCES.deliveries },
  { to: "/payments", label: "Payments", icon: CreditCard, resource: RESOURCES.payments },
  { to: "/labels", label: "Labels & stock", icon: Boxes, resource: RESOURCES.labelStock },
  { to: "/costs", label: "Variable costs", icon: Receipt, resource: RESOURCES.costs },
  { to: "/cash-position", label: "Cash Position", icon: Wallet, resource: RESOURCES.cashPosition },
  { to: "/reports", label: "Reports", icon: BarChart3, resource: RESOURCES.reports },
  { to: "/settings", label: "Rates & settings", icon: Settings, resource: RESOURCES.products },
  {
    to: "/admin/users",
    label: "Users",
    icon: Users,
    resource: RESOURCES.users,
    section: "Administration",
  },
  {
    to: "/admin/roles",
    label: "Roles & permissions",
    icon: Shield,
    resource: RESOURCES.roles,
    section: "Administration",
  },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { can } = usePermissions();

  const visible = useMemo(() => NAV.filter((item) => can(item.resource, "view")), [can]);

  return (
    <nav className="flex flex-col gap-1">
      {visible.map((item, index) => {
        const active =
          item.to === "/"
            ? pathname === "/"
            : item.to === "/shops"
              ? pathname === "/shops" ||
                (pathname.startsWith("/shops/") && !pathname.startsWith("/shops/map"))
              : pathname.startsWith(item.to);
        const startsSection = item.section && visible[index - 1]?.section !== item.section;

        return (
          <div key={item.to}>
            {startsSection && (
              <p className="mt-4 px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
                {item.section}
              </p>
            )}
            <Link
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2 px-2 pt-2">
        <span className="brand-gradient grid size-9 place-items-center rounded-xl font-display font-semibold text-primary-foreground">
          K
        </span>
        <span className="font-display text-base font-semibold text-sidebar-foreground">
          Klinzo Ops
        </span>
      </Link>
      <div className="flex-1 overflow-y-auto">
        <NavLinks onNavigate={onNavigate} />
      </div>
      <div className="border-t border-sidebar-border pt-3">
        <Link
          to="/profile"
          onClick={onNavigate}
          className="block rounded-lg px-3 py-2 hover:bg-sidebar-accent/60"
        >
          <p className="truncate text-sm font-medium text-sidebar-foreground">{user?.fullName}</p>
          <p className="truncate text-xs text-sidebar-foreground/60">{user?.email}</p>
          {user?.role && (
            <p className="mt-1 inline-flex rounded-full bg-sidebar-accent/60 px-2 py-0.5 text-[11px] font-medium text-sidebar-accent-foreground">
              {user.role.name}
            </p>
          )}
        </Link>
        <Button
          variant="ghost"
          className="mt-1 w-full justify-start text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          onClick={() => void signOut()}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-screen bg-sidebar lg:block">
        <SidebarBody />
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarBody onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="font-display font-semibold">Klinzo Ops</span>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
