import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { RequirePermission } from "@/components/require-permission";
import { TeamDashboard } from "@/components/team-dashboard";
import { RESOURCES } from "@/hooks/usePermissions";

/** `?user=<id>` opens that salesperson's own dashboard, so the phone's back button returns to the list. */
export const Route = createFileRoute("/_authenticated/salesperson-dashboard")({
  validateSearch: (search: Record<string, unknown>): { user?: string } => ({
    user: typeof search.user === "string" && search.user ? search.user : undefined,
  }),
  component: () => (
    <RequirePermission resource={RESOURCES.salespersonDashboard}>
      <SalespersonDashboardPage />
    </RequirePermission>
  ),
});

function SalespersonDashboardPage() {
  const { user } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <TeamDashboard
      kind="salespersons"
      userId={user}
      onSelect={(id) => void navigate({ search: id ? { user: id } : {} })}
    />
  );
}
