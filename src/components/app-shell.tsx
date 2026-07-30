import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, LayoutDashboard, LogOut, Lightbulb, PlusCircle, Siren } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Overzicht", icon: LayoutDashboard },
  { to: "/targets/new", label: "Targets (nieuw)", icon: PlusCircle },
  { to: "/proposals", label: "Proposals", icon: Lightbulb },
  { to: "/alerts", label: "Alerts", icon: Siren },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Link to="/" className="flex items-center gap-3 px-2 py-1">
          <span className="flex size-8 items-center justify-center rounded-md border border-sidebar-border bg-card">
            <Activity className="size-4 text-primary" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
            Watchtower
          </span>
        </Link>

        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                pathname === item.to && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleSignOut}>
            <LogOut className="size-4" />
            Uitloggen
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <span className="text-tech text-xs text-muted-foreground">
            Nomadix / Watchtower
          </span>
          <Button variant="ghost" size="sm" className="md:hidden" onClick={handleSignOut}>
            <LogOut className="size-4" />
          </Button>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
