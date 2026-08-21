import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

/**
 * Gate for every signed-in page. Anyone without a session is sent to /auth
 * with the path they wanted, so they land back where they were headed.
 *
 * Per-page permission checks live in `<RequirePermission>`; this only answers
 * "is there a session at all?".
 */
function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.href });

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth", search: { redirect: pathname }, replace: true });
    }
  }, [loading, user, pathname, navigate]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
