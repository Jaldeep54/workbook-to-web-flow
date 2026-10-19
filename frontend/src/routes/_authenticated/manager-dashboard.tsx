import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { RequirePermission } from "@/components/require-permission";
import { TeamDashboard } from "@/components/team-dashboard";
import { RESOURCES } from "@/hooks/usePermissions";

/** `?user=<id>` opens that manager's own dashboard, so the phone's back button returns to the list. */
export const Route = createFileRoute("/_authenticated/manager-dashboard")({
  validateSearch: (search: Record<string, unknown>): { user?: string } => ({
    user: typeof search.user === "string" && search.user ? search.user : undefined,
  }),
  component: () => (
    <RequirePermission resource={RESOURCES.managerDashboard}>
      <ManagerDashboardPage />
    </RequirePermission>
  ),
});

function ManagerDashboardPage() {
  const { user } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <TeamDashboard
      kind="managers"
      userId={user}
      onSelect={(id) => void navigate({ search: id ? { user: id } : {} })}
    />
  );
}
