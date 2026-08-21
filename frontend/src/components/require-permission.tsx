import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { usePermissions, type PermissionAction } from "@/hooks/usePermissions";

/**
 * Page-level guard. Wraps a page's content so a user who can reach the URL
 * (by typing it, or from a stale bookmark) sees a clear "no access" screen
 * instead of a wall of failed requests.
 *
 * This is a courtesy, not the security boundary: the API refuses the same
 * calls independently, so bypassing this component gains nothing.
 */
export function RequirePermission({
  resource,
  action = "view",
  children,
}: {
  resource: string;
  action?: PermissionAction;
  children: ReactNode;
}) {
  const { can } = usePermissions();
  if (can(resource, action)) return <>{children}</>;

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md text-center">
        <ShieldAlert className="mx-auto size-10 text-muted-foreground/60" />
        <h1 className="mt-4 text-xl font-semibold">You don't have access to this page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your role doesn't include the{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">
            {resource}:{action}
          </code>{" "}
          permission. Ask an administrator if you need it.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/">Back to overview</Link>
        </Button>
      </div>
    </div>
  );
}
