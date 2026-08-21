import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { changePassword, updateProfile } from "@/services/auth.service";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

/** The signed-in user's own account: their name, password, and what they can do. */
function ProfilePage() {
  const { user, refreshUser, signOut } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const saveName = useMutation({
    mutationFn: () => updateProfile(fullName.trim()),
    onSuccess: async () => {
      await refreshUser();
      toast.success("Profile updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Changing a password invalidates every existing session, so the user is
  // signed out and asked to sign in with the new one.
  const savePassword = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: async () => {
      toast.success("Password changed — please sign in again");
      setCurrentPassword("");
      setNewPassword("");
      await signOut();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader title="Your profile" description={user?.email} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface-card space-y-4 p-5">
          <h2 className="text-base font-semibold">Details</h2>
          <div className="space-y-1.5">
            <Label className="text-xs">Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Email</Label>
            <Input value={user?.email ?? ""} disabled />
            <p className="text-xs text-muted-foreground">
              Only an administrator can change the email on an account.
            </p>
          </div>
          <Button
            onClick={() => saveName.mutate()}
            disabled={fullName.trim().length < 2 || saveName.isPending}
          >
            Save details
          </Button>
        </div>

        <div className="surface-card space-y-4 p-5">
          <h2 className="text-base font-semibold">Change password</h2>
          <div className="space-y-1.5">
            <Label className="text-xs">Current password</Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">New password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least 8 characters with an uppercase letter, a lowercase letter and a number.
            </p>
          </div>
          <Button
            onClick={() => savePassword.mutate()}
            disabled={!currentPassword || newPassword.length < 8 || savePassword.isPending}
          >
            Change password
          </Button>
        </div>

        <div className="surface-card p-5 lg:col-span-2">
          <h2 className="text-base font-semibold">Your access</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Role: <span className="font-medium text-foreground">{user?.role?.name ?? "—"}</span> ·
            These permissions are enforced by the server on every request.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(user?.permissions ?? []).map((permission) => (
              <Badge key={permission} variant="secondary" className="font-mono text-[11px]">
                {permission}
              </Badge>
            ))}
            {(user?.permissions ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No permissions assigned yet — ask an administrator.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
