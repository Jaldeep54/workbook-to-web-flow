import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
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
  const { user, loading, sessionError, retrySession } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.href });

  useEffect(() => {
    // An unreachable server is not a missing session — stay put and offer a retry.
    if (!loading && !user && !sessionError) {
      navigate({ to: "/auth", search: { redirect: pathname }, replace: true });
    }
  }, [loading, user, sessionError, pathname, navigate]);

  if (!loading && !user && sessionError) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <div className="max-w-sm text-center">
          <p className="font-medium text-foreground">{sessionError}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You're still signed in. Check your connection and try again.
          </p>
          <Button className="mt-4" onClick={retrySession}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

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
