import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Coins, PlusCircle } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { isAcknowledged, useIncidents } from "@/components/incidents";
import { IncidentsWeekly, LatencyGrid } from "@/components/charts";
import { VisitorsOverview } from "@/components/site-analytics";

export const Route = createFileRoute("/_authenticated/sites")({
  head: () => ({
    meta: [
      { title: "Sites — Nomadix Watchtower" },
      { name: "description", content: "Alle bewaakte sites met hun status, snelheid en bezoekers." },
    ],
  }),
  component: SitesPage,
});

const GROUPS: Array<{ name: string; kinds: string[] }> = [
  { name: "SellQo & winkels", kinds: ["platform", "storefront"] },
  { name: "Eigen ventures", kinds: ["venture"] },
  { name: "Klantensites", kinds: ["client_site"] },
];

const LEVEL_COLOR: Record<string, string> = {
  actie: "var(--crit)",
  aandacht: "var(--warn)",
  rustig: "var(--ok)",
  erkend: "var(--muted-foreground)",
  onbekend: "var(--muted-foreground)",
};

const LEVEL_LABEL: Record<string, string> = {
  actie: "Actie",
  aandacht: "Aandacht",
  rustig: "Rustig",
  erkend: "Erkend",
  onbekend: "Nog geen meting",
};

function SitesPage() {
  const targetsQuery = useQuery({
    queryKey: ["watch_targets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watch_targets")
        .select("*")
        .eq("enabled", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });
  const creditsQuery = useQuery({
    queryKey: ["credit_latest", "teaser"],
    queryFn: async () => {
      const { data } = await supabase.from("credit_latest").select("project_name, exec_s_per_day");
      const list = (data ?? []).filter((r) => r.exec_s_per_day != null);
      const total = list.reduce((s, r) => s + Number(r.exec_s_per_day), 0);
      const top = [...list].sort((a, b) => Number(b.exec_s_per_day) - Number(a.exec_s_per_day))[0];
      return { total, top };
    },
  });
  const incidents = useIncidents().data ?? [];
  const targets = targetsQuery.data ?? [];

  const levelOf = (targetId: string): string => {
    const mine = incidents.filter((i) => i.target_id === targetId && i.severity !== "monitor");
    if (mine.some((i) => i.severity === "actie" && !isAcknowledged(i))) return "actie";
    if (mine.some((i) => i.severity === "aandacht" && !isAcknowledged(i))) return "aandacht";
    if (mine.some((i) => isAcknowledged(i))) return "erkend";
    const t = targets.find((x) => x.id === targetId);
    return t?.status === "unknown" ? "onbekend" : "rustig";
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-8">
        <PageHeader
          eyebrow="Sites"
          title={`${targets.length} sites bewaakt`}
          subtitle="Klik een site voor alle metingen, de geschiedenis en de instellingen."
          actions={
            <Link
              to="/targets/new"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-secondary/40"
            >
              <PlusCircle className="size-4" />
              Site toevoegen
            </Link>
          }
        />

        <section className="space-y-6">
          {GROUPS.map((g) => {
            const list = targets.filter((t) => g.kinds.includes(t.kind));
            if (!list.length) return null;
            return (
              <div key={g.name}>
                <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {g.name}
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((t) => {
                    const lv = levelOf(t.id);
                    return (
                      <Link
                        key={t.id}
                        to="/target/$id"
                        params={{ id: t.id }}
                        className="flex min-h-12 items-center gap-3 rounded-xl border border-transparent bg-card px-3.5 py-2.5 transition-colors hover:border-border"
                      >
                        <span
                          className="inline-block size-2.5 shrink-0 rounded-full"
                          style={{ background: LEVEL_COLOR[lv] }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{t.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {t.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs" style={{ color: LEVEL_COLOR[lv] }}>
                          {LEVEL_LABEL[lv]}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <LatencyGrid targets={targets.filter((t) => t.kind === "platform" || t.kind === "storefront")} />

        <VisitorsOverview targets={targets} />

        <IncidentsWeekly />

        {creditsQuery.data?.top && (
          <Link to="/kosten" className="panel flex items-center gap-4 p-5 transition-colors hover:border-primary/40">
            <span className="brand-gradient flex size-11 shrink-0 items-center justify-center rounded-2xl">
              <Coins className="size-5 text-[#06202c]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Credits</span>
              <span className="block truncate text-sm text-muted-foreground">
                {creditsQuery.data.top.project_name} neemt{" "}
                {Math.round((Number(creditsQuery.data.top.exec_s_per_day) / (creditsQuery.data.total || 1)) * 100)}% van de
                rekentijd
              </span>
            </span>
          </Link>
        )}
      </div>
    </AppShell>
  );
}
