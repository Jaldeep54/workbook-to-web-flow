import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { RequirePermission } from "@/components/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Can, RESOURCES } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { permissionsApi, rolesApi, type ManagedRole } from "@/services/klinzo.service";

export const Route = createFileRoute("/_authenticated/admin/roles")({
  component: RolesPage,
});

/**
 * Roles and permissions.
 *
 * The matrix is built from the permission catalogue the API returns, not from
 * a hard-coded list — a module added later shows up here automatically once
 * its permissions are seeded, which is what makes the system extensible
 * without code changes.
 */
function RolesPage() {
  return (
    <RequirePermission resource={RESOURCES.roles}>
      <RolesView />
    </RequirePermission>
  );
}

const ACTION_ORDER = ["view", "create", "update", "delete", "manage"];

function RolesView() {
  const qc = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ name: "", description: "" });
  const [deleting, setDeleting] = useState<ManagedRole | null>(null);

  const roles = useQuery({ queryKey: ["admin_roles"], queryFn: () => rolesApi.list() });
  const catalogue = useQuery({
    queryKey: ["admin_permissions"],
    queryFn: () => permissionsApi.catalogue(),
  });

  const selectedRole = useMemo(
    () => roles.data?.find((role) => role.id === selectedRoleId) ?? roles.data?.[0] ?? null,
    [roles.data, selectedRoleId],
  );

  // The draft follows whichever role is selected — and re-syncs after a save,
  // hence keying on the permission list rather than just the role id.
  const selectedRoleId_ = selectedRole?.id ?? null;
  const selectedPermissionKey = selectedRole?.permissionIds.join(",") ?? "";
  useEffect(() => {
    setDraft(new Set(selectedPermissionKey ? selectedPermissionKey.split(",") : []));
  }, [selectedRoleId_, selectedPermissionKey]);

  const dirty = useMemo(() => {
    if (!selectedRole) return false;
    const current = new Set(selectedRole.permissionIds);
    if (current.size !== draft.size) return true;
    for (const id of draft) if (!current.has(id)) return true;
    return false;
  }, [selectedRole, draft]);

  const savePermissions = useMutation({
    mutationFn: () => rolesApi.setPermissions(selectedRole!.id, Array.from(draft)),
    onSuccess: () => {
      toast.success(`Permissions updated for ${selectedRole?.name}`);
      void qc.invalidateQueries({ queryKey: ["admin_roles"] });
      // The signed-in user's own grants may have just changed.
      void qc.invalidateQueries({ queryKey: ["auth_me"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createRole = useMutation({
    mutationFn: () =>
      rolesApi.create({ name: newRole.name.trim(), description: newRole.description.trim() }),
    onSuccess: (role) => {
      toast.success(`Role "${role.name}" created`);
      setCreating(false);
      setNewRole({ name: "", description: "" });
      setSelectedRoleId(role.id);
      void qc.invalidateQueries({ queryKey: ["admin_roles"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeRole = useMutation({
    mutationFn: (role: ManagedRole) => rolesApi.remove(role.id),
    onSuccess: () => {
      toast.success("Role deleted");
      setDeleting(null);
      setSelectedRoleId(null);
      void qc.invalidateQueries({ queryKey: ["admin_roles"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = (permissionId: string) =>
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });

  const toggleResource = (actionIds: string[], enable: boolean) =>
    setDraft((prev) => {
      const next = new Set(prev);
      for (const id of actionIds) {
        if (enable) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Create roles and choose exactly what each one can see and do. The API enforces these rules on every request."
        actions={
          <Can resource={RESOURCES.roles} action="create">
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New role
            </Button>
          </Can>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="surface-card h-fit p-2">
          {(roles.data ?? []).map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedRoleId(role.id)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
                role.id === selectedRole?.id ? "bg-secondary" : "hover:bg-secondary/60",
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-medium">{role.name}</span>
                {role.isSystem && (
                  <Badge variant="secondary" className="gap-1">
                    <Shield className="size-3" /> System
                  </Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {role.permissionCount} permissions · {role.userCount} user
                {role.userCount === 1 ? "" : "s"}
              </span>
            </button>
          ))}
          {roles.isLoading && (
            <p className="px-3 py-4 text-sm text-muted-foreground">Loading roles…</p>
          )}
        </div>

        <div className="surface-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 className="text-base font-semibold">{selectedRole?.name ?? "Select a role"}</h2>
              <p className="text-xs text-muted-foreground">
                {selectedRole?.description || "No description"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Can resource={RESOURCES.roles} action="delete">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selectedRole || selectedRole.isSystem}
                  onClick={() => selectedRole && setDeleting(selectedRole)}
                >
                  <Trash2 className="size-4" /> Delete role
                </Button>
              </Can>
              <Can resource={RESOURCES.roles} action="manage">
                <Button
                  size="sm"
                  disabled={!selectedRole || !dirty || savePermissions.isPending}
                  onClick={() => savePermissions.mutate()}
                >
                  <Save className="size-4" /> Save permissions
                </Button>
              </Can>
            </div>
          </div>

          <div className="max-h-[65vh] overflow-y-auto p-4">
            {(catalogue.data?.groups ?? []).map((group) => (
              <section key={group.group} className="mb-6 last:mb-0">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.group}
                </h3>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="p-2 text-left font-medium">Page / module</th>
                        {ACTION_ORDER.map((action) => (
                          <th key={action} className="w-20 p-2 text-center font-medium capitalize">
                            {action}
                          </th>
                        ))}
                        <th className="w-16 p-2 text-center font-medium">All</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.resources.map((resource) => {
                        const actionIds = resource.actions.map((a) => a.id);
                        const allOn = actionIds.every((id) => draft.has(id));
                        return (
                          <tr key={resource.resource} className="border-t border-border">
                            <td className="p-2">
                              <p className="font-medium">{resource.label}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {resource.resource}
                              </p>
                            </td>
                            {ACTION_ORDER.map((action) => {
                              const permission = resource.actions.find((a) => a.action === action);
                              return (
                                <td key={action} className="p-2 text-center">
                                  {permission ? (
                                    <Checkbox
                                      checked={draft.has(permission.id)}
                                      onCheckedChange={() => toggle(permission.id)}
                                      aria-label={permission.name}
                                    />
                                  ) : (
                                    <span className="text-muted-foreground/40">—</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="p-2 text-center">
                              <Checkbox
                                checked={allOn}
                                onCheckedChange={(checked) =>
                                  toggleResource(actionIds, checked === true)
                                }
                                aria-label={`All ${resource.label} permissions`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            {selectedRole?.isSystem && (
              <p className="text-xs text-muted-foreground">
                The Admin role always keeps full access — including permissions added in future
                releases — so the system can never be left without an administrator.
              </p>
            )}
          </div>
        </div>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>
              Create the role first, then tick the permissions it should have.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Role name</Label>
              <Input
                value={newRole.name}
                placeholder="e.g. Marketing"
                onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Input
                value={newRole.description}
                placeholder="What this role is for"
                onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => createRole.mutate()}
              disabled={newRole.name.trim().length < 2 || createRole.isPending}
            >
              Create role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the {deleting?.name} role?</AlertDialogTitle>
            <AlertDialogDescription>
              Roles still assigned to users can't be deleted — move those users to another role
              first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && removeRole.mutate(deleting)}>
              Delete role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
