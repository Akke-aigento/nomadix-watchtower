import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarClock,
  Coins,
  Globe,
  LayoutGrid,
  Lightbulb,
  LogOut,
  MoreHorizontal,
  Plug,
  PlusCircle,
  Siren,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: LucideIcon; badge?: "proposals" | "access" };

/** Hoofdtabs: op de telefoon onderaan, op desktop bovenaan in de zijbalk. */
const MAIN: NavItem[] = [
  { to: "/dashboard", label: "Vandaag", icon: Sun },
  { to: "/proposals", label: "Voorstellen", icon: Lightbulb, badge: "proposals" },
  { to: "/kosten", label: "Credits", icon: Coins },
  { to: "/koppelingen", label: "Koppelingen", icon: Plug },
];

/** De rest: op de telefoon achter "Meer". */
const MORE: NavItem[] = [
  { to: "/agenda", label: "Agenda", icon: CalendarClock },
  { to: "/meldingen", label: "Meldingen", icon: Bell },
  { to: "/alerts", label: "Geschiedenis", icon: Siren },
  { to: "/toegang", label: "Toegang tot websites", icon: Globe, badge: "access" },
  { to: "/targets/new", label: "Site toevoegen", icon: PlusCircle },
];

export function LogoMark({ className }: { className?: string }) {
  return <img src="/logo-mark.svg" alt="" aria-hidden="true" className={className} />;
}

function useBadges() {
  const q = useQuery({
    queryKey: ["nav_badges"],
    queryFn: async () => {
      const [p, a] = await Promise.all([
        supabase
          .from("proposals")
          .select("id", { count: "exact", head: true })
          .eq("status", "proposed"),
        supabase
          .from("web_access")
          .select("domain", { count: "exact", head: true })
          .eq("status", "gevraagd"),
      ]);
      return { proposals: p.count ?? 0, access: a.count ?? 0 };
    },
    refetchInterval: 120_000,
  });
  return q.data ?? { proposals: 0, access: 0 };
}

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="tabular ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Kop van een scherm: klein label, grote titel, optionele uitleg en acties. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pt-1">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[28px] font-bold leading-tight tracking-tight md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const badges = useBadges();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE.some((m) => pathname.startsWith(m.to));

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  const isActive = (to: string) =>
    pathname === to || (to !== "/dashboard" && pathname.startsWith(to));

  const sideLink = (item: NavItem) => (
    <Link
      key={item.to}
      to={item.to}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        isActive(item.to) && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <item.icon className={cn("size-[18px]", isActive(item.to) && "text-primary")} />
      {item.label}
      {item.badge && <Badge n={badges[item.badge]} />}
    </Link>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 md:flex">
        <Link to="/dashboard" className="flex items-center gap-3 px-2">
          <LogoMark className="size-9" />
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight text-sidebar-foreground">
              Watchtower
            </div>
            <div className="text-[11px] text-muted-foreground">Studio Akke · Nomadix</div>
          </div>
        </Link>

        <nav className="mt-8 flex flex-col gap-1">{MAIN.map(sideLink)}</nav>
        <div className="mt-6 mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
          Meer
        </div>
        <nav className="flex flex-col gap-1">{MORE.map(sideLink)}</nav>

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="size-[18px]" />
          Uitloggen
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-border/60 bg-background/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:hidden">
          <Link to="/dashboard" className="flex h-12 items-center gap-2.5">
            <LogoMark className="size-7" />
            <span className="text-[15px] font-bold tracking-tight">Watchtower</span>
          </Link>
        </header>
        <main className="flex-1 px-4 pt-5 pb-32 md:px-8 md:pt-8 md:pb-10">{children}</main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        aria-label="Hoofdmenu"
      >
        {MAIN.map((item) => {
          const active = isActive(item.to);
          const n = item.badge ? badges[item.badge] : 0;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "relative flex min-h-[58px] flex-col items-center justify-center gap-1 text-[10.5px] font-medium text-muted-foreground",
                active && "text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                  active && "bg-primary/15",
                )}
              >
                <item.icon className={cn("size-[20px]", active && "text-primary")} />
              </span>
              {item.label}
              {n > 0 && (
                <span className="tabular absolute top-1.5 left-1/2 ml-2 min-w-4 rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">
                  {n}
                </span>
              )}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            "relative flex min-h-[58px] flex-col items-center justify-center gap-1 text-[10.5px] font-medium text-muted-foreground",
            moreActive && "text-foreground",
          )}
        >
          <span
            className={cn(
              "flex h-7 w-12 items-center justify-center rounded-full",
              moreActive && "bg-primary/15",
            )}
          >
            <MoreHorizontal className={cn("size-[20px]", moreActive && "text-primary")} />
          </span>
          Meer
          {badges.access > 0 && (
            <span className="absolute top-2 left-1/2 ml-3 size-2 rounded-full bg-primary" />
          )}
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl border-border bg-popover pb-[calc(env(safe-area-inset-bottom)+16px)]"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-left">
              <LayoutGrid className="size-4 text-primary" /> Meer
            </SheetTitle>
          </SheetHeader>
          <div className="mt-2 grid gap-1 px-2">
            {MORE.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-3.5 text-[15px] font-medium hover:bg-accent"
              >
                <item.icon className="size-5 text-primary" />
                {item.label}
                {item.badge && <Badge n={badges[item.badge]} />}
              </Link>
            ))}
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-3 rounded-xl px-3 py-3.5 text-left text-[15px] font-medium text-muted-foreground hover:bg-accent"
            >
              <LogOut className="size-5" />
              Uitloggen
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
