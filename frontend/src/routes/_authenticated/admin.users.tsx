import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { KeyRound, Plus, Search, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { RequirePermission } from "@/components/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Can, RESOURCES } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { dateLabel } from "@/lib/format";
import {
  permissionsApi,
  rolesApi,
  usersApi,
  type ManagedUser,
  type PermissionRow,
} from "@/services/klinzo.service";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: UsersPage,
});

/**
 * User administration: who exists, what role they hold, and any extra
 * permissions granted to them individually on top of it.
 *
 * Everything here is a request to the API, which enforces the same rules again
 * — including refusing to strand the system without an administrator.
 */
function UsersPage() {
  return (
    <RequirePermission resource={RESOURCES.users}>
      <UsersView />
    </RequirePermission>
  );
}

const emptyForm = {
  email: "",
  fullName: "",
  password: "",
  role: "",
  isActive: true,
  directPermissions: [] as string[],
};

function UsersView() {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [deleting, setDeleting] = useState<ManagedUser | null>(null);

  const users = useQuery({
    queryKey: ["admin_users", search],
    queryFn: () => usersApi.list({ search: search || undefined }),
  });
  const roles = useQuery({ queryKey: ["admin_roles"], queryFn: () => rolesApi.list() });
  const catalogue = useQuery({
    queryKey: ["admin_permissions"],
    queryFn: () => permissionsApi.catalogue(),
  });

  const permissionsById = useMemo(() => {
    const map = new Map<string, PermissionRow>();
    for (const p of catalogue.data?.permissions ?? []) map.set(p.id, p);
    return map;
  }, [catalogue.data]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin_users"] });
    void qc.invalidateQueries({ queryKey: ["admin_roles"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        return usersApi.update(editing.id, {
          email: form.email.trim(),
          fullName: form.fullName.trim(),
          role: form.role,
          isActive: form.isActive,
          directPermissions: form.directPermissions,
        });
      }
      return usersApi.create({
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        password: form.password,
        role: form.role,
        isActive: form.isActive,
        directPermissions: form.directPermissions,
      });
    },
    onSuccess: () => {
      toast.success(editing ? "User updated" : "User created");
      setOpen(false);
      setEditing(null);
      setForm({ ...emptyForm });
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resetPassword = useMutation({
    mutationFn: () => usersApi.resetPassword(resetting!.id, newPassword),
    onSuccess: () => {
      toast.success(`Password updated for ${resetting?.email}`);
      setResetting(null);
      setNewPassword("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (user: ManagedUser) => usersApi.remove(user.id),
    onSuccess: () => {
      toast.success("User deleted");
      setDeleting(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, role: roles.data?.[0]?.id ?? "" });
    setOpen(true);
  };

  const openEdit = (user: ManagedUser) => {
    setEditing(user);
    setForm({
      email: user.email,
      fullName: user.fullName,
      password: "",
      role: user.role?.id ?? "",
      isActive: user.isActive,
      directPermissions: user.directPermissions ?? [],
    });
    setOpen(true);
  };

  const rows = users.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in, the role they hold, and any extra permissions granted to them individually"
        actions={
          <Can resource={RESOURCES.users} action="create">
            <Button onClick={openCreate}>
              <Plus className="size-4" /> New user
            </Button>
          </Can>
        }
      />

      <div className="surface-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Extra permissions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Loading users…
                  </TableCell>
                </TableRow>
              )}
              {!users.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    No users match this search.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <p className="font-medium">{user.fullName}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{user.role?.name ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    {user.directPermissions.length === 0 ? (
                      <span className="text-xs text-muted-foreground">None</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {user.directPermissions
                          .map((id) => permissionsById.get(id)?.name ?? id)
                          .join(", ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? "default" : "secondary"}>
                      {user.isActive ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {user.lastLoginAt ? dateLabel(user.lastLoginAt) : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Can resource={RESOURCES.users} action="update">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${user.fullName}`}
                          onClick={() => openEdit(user)}
                        >
                          <UserCog className="size-4" />
                        </Button>
                      </Can>
                      <Can resource={RESOURCES.users} action="manage">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Reset password for ${user.fullName}`}
                          onClick={() => {
                            setResetting(user);
                            setNewPassword("");
                          }}
                        >
                          <KeyRound className="size-4" />
                        </Button>
                      </Can>
                      <Can resource={RESOURCES.users} action="delete">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${user.fullName}`}
                          disabled={user.id === currentUser?.id}
                          onClick={() => setDeleting(user)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </Can>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : setOpen(false))}>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{editing ? `Edit ${editing.fullName}` : "New user"}</DialogTitle>
            <DialogDescription>
              A user's role decides what they can reach. Extra permissions are additive — use them
              for one-off exceptions rather than creating a role for a single person.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Full name</Label>
              <Input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label className="text-xs">Temporary password</Label>
                <Input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  At least 8 characters with an uppercase letter, a lowercase letter and a number.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={form.role} onValueChange={(role) => setForm({ ...form, role })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {(roles.data ?? []).map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="user-active"
                checked={form.isActive}
                onCheckedChange={(isActive) => setForm({ ...form, isActive })}
              />
              <Label htmlFor="user-active">Account is active</Label>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <Label className="text-xs">Extra permissions (optional)</Label>
              <div className="max-h-48 space-y-3 overflow-y-auto rounded-md border border-border p-3">
                {(catalogue.data?.groups ?? []).map((group) => (
                  <div key={group.group}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.group}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {group.resources.flatMap((resource) =>
                        resource.actions.map((action) => {
                          const selected = form.directPermissions.includes(action.id);
                          return (
                            <button
                              key={action.id}
                              type="button"
                              onClick={() =>
                                setForm({
                                  ...form,
                                  directPermissions: selected
                                    ? form.directPermissions.filter((id) => id !== action.id)
                                    : [...form.directPermissions, action.id],
                                })
                              }
                              className={
                                selected
                                  ? "rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground"
                                  : "rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary/70"
                              }
                            >
                              {action.name}
                            </button>
                          );
                        }),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 pb-6">
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending ||
                !form.fullName.trim() ||
                !form.email.trim() ||
                !form.role ||
                (!editing && form.password.length < 8)
              }
            >
              {editing ? "Save changes" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetting} onOpenChange={(next) => !next && setResetting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set a new password</DialogTitle>
            <DialogDescription>
              {resetting?.email} will be signed out everywhere and must use the new password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">New password</Label>
            <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              onClick={() => resetPassword.mutate()}
              disabled={newPassword.length < 8 || resetPassword.isPending}
            >
              Update password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.fullName}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access immediately. Records they created are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting)}>
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
