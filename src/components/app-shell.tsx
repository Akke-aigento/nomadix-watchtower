import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, LayoutDashboard, LogOut, Lightbulb, PlusCircle, Siren } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Overzicht", short: "Overzicht", icon: LayoutDashboard },
  { to: "/alerts", label: "Geschiedenis", short: "Historiek", icon: Siren },
  { to: "/proposals", label: "Voorstellen", short: "Voorstellen", icon: Lightbulb },
  { to: "/meldingen", label: "Meldingen", short: "Meldingen", icon: Bell },
  { to: "/targets/new", label: "Target toevoegen", short: "Nieuw", icon: PlusCircle },
] as const;

export function LogoMark({ className }: { className?: string }) {
  return <img src="/logo-mark.svg" alt="" aria-hidden="true" className={className} />;
}

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
        <Link to="/dashboard" className="flex items-center gap-3 px-2 py-1">
          <LogoMark className="size-8" />
          <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">Watchtower</span>
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
        <header className="flex h-14 items-center justify-between border-b border-border px-4 pt-[env(safe-area-inset-top)] md:px-6">
          <Link to="/dashboard" className="flex items-center gap-2 md:hidden">
            <LogoMark className="size-7" />
            <span className="text-sm font-semibold">Watchtower</span>
          </Link>
          <span className="text-tech hidden text-xs text-muted-foreground md:inline">Nomadix / Watchtower</span>
          <Button variant="ghost" size="sm" className="md:hidden" aria-label="Uitloggen" onClick={handleSignOut}>
            <LogOut className="size-4" />
          </Button>
        </header>
        <main className="flex-1 p-4 pb-28 md:p-6 md:pb-6">{children}</main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Hoofdmenu"
      >
        {NAV.slice(0, 4).map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground",
              pathname === item.to && "text-foreground",
            )}
          >
            <item.icon className="size-5" />
            {item.short}
          </Link>
        ))}
      </nav>
    </div>
  );
}
