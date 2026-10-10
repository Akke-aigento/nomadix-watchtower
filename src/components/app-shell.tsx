import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarClock,
  Coins,
  Globe,
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
import { DetailPanel } from "@/components/detail-panel";
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
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/[0.06] bg-[#0a1728]/60 px-4 py-5 backdrop-blur-2xl md:flex">
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
        <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-white/[0.06] bg-[#0b1a2e]/70 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-2xl md:hidden">
          <Link to="/dashboard" className="flex h-12 items-center gap-2.5">
            <LogoMark className="size-7" />
            <span className="text-[15px] font-bold tracking-tight">Watchtower</span>
          </Link>
        </header>
        <main className="flex-1 px-4 pt-5 pb-36 md:px-8 md:pt-8 md:pb-10">{children}</main>
      </div>

      {/* Zwevende tabbalk (telefoon) */}
      <nav
        className="glass-bar fixed inset-x-3 z-40 grid grid-cols-5 rounded-[26px] p-1.5 md:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
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
                "relative flex h-[54px] flex-col items-center justify-center gap-0.5 rounded-[20px] text-[10.5px] font-semibold text-muted-foreground transition-all active:scale-95",
                active && "text-[#06202c]",
              )}
              style={
                active
                  ? {
                      background: "linear-gradient(135deg,#2dd4bf,#22d3ee 55%,#38bdf8)",
                      boxShadow: "0 8px 24px -8px rgb(34 211 238 / 65%)",
                    }
                  : undefined
              }
            >
              <item.icon className="size-[20px]" strokeWidth={active ? 2.4 : 2} />
              {item.label}
              {n > 0 && (
                <span
                  className={cn(
                    "tabular absolute top-1 right-[18%] min-w-4 rounded-full px-1 text-[10px] font-bold leading-4",
                    active ? "bg-[#06202c] text-white" : "bg-primary text-primary-foreground",
                  )}
                >
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
            "relative flex h-[54px] flex-col items-center justify-center gap-0.5 rounded-[20px] text-[10.5px] font-semibold text-muted-foreground transition-all active:scale-95",
            moreActive && "bg-white/10 text-foreground",
          )}
        >
          <MoreHorizontal className="size-[20px]" />
          Meer
          {badges.access > 0 && (
            <span className="absolute top-2 right-[26%] size-2 rounded-full bg-primary" />
          )}
        </button>
      </nav>

      <DetailPanel open={moreOpen} onClose={() => setMoreOpen(false)} eyebrow="Meer" title="Meer">
        <div className="grid grid-cols-2 gap-2.5 pt-2">
          {MORE.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMoreOpen(false)}
              className={cn(
                "panel relative flex min-h-[104px] flex-col justify-between p-4 transition-transform active:scale-[0.98]",
                isActive(item.to) && "glow-border",
              )}
            >
              <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/15">
                <item.icon className="size-5 text-primary" />
              </span>
              <span className="flex items-center gap-2 text-[15px] font-semibold leading-tight">
                {item.label}
                {item.badge && <Badge n={badges[item.badge]} />}
              </span>
            </Link>
          ))}
          <button
            type="button"
            onClick={handleSignOut}
            className="panel flex min-h-[104px] flex-col justify-between p-4 text-left text-muted-foreground transition-transform active:scale-[0.98]"
          >
            <span className="flex size-10 items-center justify-center rounded-2xl bg-white/[0.06]">
              <LogOut className="size-5" />
            </span>
            <span className="text-[15px] font-semibold">Uitloggen</span>
          </button>
        </div>
      </DetailPanel>
    </div>
  );
}
