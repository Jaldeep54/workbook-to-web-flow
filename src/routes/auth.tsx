import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Klinzo Operations" },
      {
        name: "description",
        content: "Sign in to manage Klinzo shops, orders, deliveries and label stock.",
      },
      { property: "og:title", content: "Sign in — Klinzo Operations" },
      { property: "og:description", content: "Secure access to the Klinzo operations dashboard." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const target = search.redirect && search.redirect.startsWith("/") ? search.redirect : "/";

  useEffect(() => {
    if (!loading && session) navigate({ to: target, replace: true });
  }, [loading, session, target, navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome back");
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="brand-gradient absolute -right-24 -top-24 size-96 rounded-full opacity-25 blur-3xl" />
        <div className="flex items-center gap-2 font-display text-xl font-semibold">
          <span className="brand-gradient grid size-9 place-items-center rounded-xl text-sidebar-primary-foreground">
            K
          </span>
          Klinzo Operations
        </div>
        <div className="relative max-w-md space-y-4">
          <h1 className="text-4xl font-semibold leading-tight">
            The workbook, without the waiting.
          </h1>
          <p className="text-sm text-sidebar-foreground/80">
            100+ shop sheets and 1.5 million volatile formulas replaced by a relational database.
            Same numbers, same rules — instant dashboards, filters and exports.
          </p>
          <ul className="space-y-2 text-sm text-sidebar-foreground/70">
            <li>• Orders, deliveries, payments and label stock in one place</li>
            <li>• Profit and cost formulas preserved exactly</li>
            <li>• Import your existing Excel file in one step</li>
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-foreground/50">Internal use only</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="brand-gradient inline-grid size-10 place-items-center rounded-xl font-display font-semibold text-primary-foreground">
              K
            </span>
          </div>
          <h2 className="text-2xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Access the Klinzo operations dashboard. Accounts are created by an administrator —
            contact them if you don't have credentials yet.
          </p>

          <form className="mt-6 space-y-4" onSubmit={signIn}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Sign in
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
