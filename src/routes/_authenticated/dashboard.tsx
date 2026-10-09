import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { IncidentList, isAcknowledged, useIncidents } from "@/components/incidents";
import {
  CategoryBadge,
  KindBadge,
  StatusDot,
  relativeTime,
} from "@/components/watchtower";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Overzicht — Nomadix Watchtower" },
      { name: "description", content: "Monitoring-overzicht van alle Nomadix-properties." },
      { property: "og:title", content: "Overzicht — Nomadix Watchtower" },
      {
        property: "og:description",
        content: "Monitoring-overzicht van alle Nomadix-properties.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

const RANK: Record<string, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 };

function DashboardPage() {
  const queryClient = useQueryClient();

  const targetsQuery = useQuery({
    queryKey: ["watch_targets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("watch_targets").select("*");
      if (error) throw error;
      return data;
    },
  });

  const latencyQuery = useQuery({
    queryKey: ["http_latency"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_results")
        .select("target_id, latency_ms, measured_at")
        .eq("check_key", "http")
        .order("measured_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const byTarget: Record<string, { latency: number }[]> = {};
      for (const row of data ?? []) {
        const list = (byTarget[row.target_id] ??= []);
        if (list.length < 24 && typeof row.latency_ms === "number")
          list.push({ latency: row.latency_ms });
      }
      for (const key of Object.keys(byTarget)) byTarget[key].reverse();
      return byTarget;
    },
  });

  const proposalsQuery = useQuery({
    queryKey: ["proposals", "open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("*")
        .in("status", ["proposed", "approved"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("proposals")
        .update({ status, decided_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      toast.success(vars.status === "approved" ? "Voorstel goedgekeurd" : "Voorstel afgewezen");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const targets = targetsQuery.data ?? [];
  const counts = {
    ok: targets.filter((t) => t.status === "ok").length,
    warn: targets.filter((t) => t.status === "warn").length,
    fail: targets.filter((t) => t.status === "fail").length,
  };
  const lastScan = targets
    .map((t) => t.last_scanned_at)
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined;

  const sorted = [...targets].sort((a, b) => {
    const r = (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2);
    return r !== 0 ? r : a.name.localeCompare(b.name, "nl");
  });

  const incidentsQuery = useIncidents();
  const incidents = incidentsQuery.data ?? [];
  const activeIncidents = incidents.filter((i) => !isAcknowledged(i) && i.severity !== "monitor");
  const headline =
    activeIncidents.some((i) => i.severity === "actie")
      ? `${activeIncidents.filter((i) => i.severity === "actie").length} ding(en) vragen actie`
      : activeIncidents.length > 0
        ? `${activeIncidents.length} ding(en) vragen aandacht`
        : "Alles rustig";

  const proposed = (proposalsQuery.data ?? []).filter((p) => p.status === "proposed");
  const approved = (proposalsQuery.data ?? []).filter((p) => p.status === "approved");

  return (
    <AppShell>
      <div className="space-y-8">
        <header className="fade-in-card panel flex flex-wrap items-center gap-6 p-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{headline}</h1>
            <p className="text-tech mt-1 text-[11px] text-muted-foreground">
              Laatste scan: {relativeTime(lastScan)}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-6">
            <Metric label="OK" value={counts.ok} status="ok" />
            <Metric label="Warn" value={counts.warn} status="warn" />
            <Metric label="Fail" value={counts.fail} status="fail" />
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-tech text-xs text-muted-foreground">Incidenten</h2>
          {incidentsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Laden…</p>
          ) : (
            <IncidentList incidents={incidents} emptyText="Geen open incidenten — alles rustig." />
          )}
        </section>

        {proposed.length + approved.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-tech text-xs text-muted-foreground">Wacht op jouw go</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {proposed.map((p, i) => (
                <article
                  key={p.id}
                  className="fade-in-card panel p-4"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <CategoryBadge category={p.category} />
                    <span className="text-tech text-[10px] text-muted-foreground">
                      {relativeTime(p.created_at)}
                    </span>
                  </div>
                  <h3 className="mt-2 font-medium">{p.title}</h3>
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{p.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="text-tech">Actie:</span> {p.proposed_action}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: p.id, status: "approved" })}
                    >
                      Go
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: p.id, status: "rejected" })}
                    >
                      Afwijzen
                    </Button>
                  </div>
                </article>
              ))}
            </div>

            {approved.length > 0 && (
              <div className="panel p-4">
                <h3 className="text-tech text-[11px] text-muted-foreground">
                  Goedgekeurd — wacht op uitvoering
                </h3>
                <ul className="mt-2 space-y-1">
                  {approved.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-sm">
                      <CategoryBadge category={p.category} />
                      <span className="truncate">{p.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-tech text-xs text-muted-foreground">Targets</h2>
          {targetsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Laden…</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sorted.map((t, i) => (
                <Link
                  key={t.id}
                  to="/target/$id"
                  params={{ id: t.id }}
                  className="fade-in-card panel block p-4 transition-colors hover:border-primary/50"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <div className="flex items-start gap-2">
                    <StatusDot status={t.status} className="mt-1.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-medium">{t.name}</h3>
                        <KindBadge kind={t.kind} />
                      </div>
                      <p className="text-tech mt-0.5 truncate text-[10px] text-muted-foreground">
                        {t.url.replace(/^https?:\/\//, "")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 h-10">
                    <Sparkline data={latencyQuery.data?.[t.id] ?? []} status={t.status} />
                  </div>
                  <p className="text-tech mt-2 text-[10px] text-muted-foreground">
                    {relativeTime(t.last_scanned_at)}
                    {!t.enabled && " · uitgeschakeld"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, status }: { label: string; value: number; status: string }) {
  return (
    <div className="flex items-center gap-2">
      <StatusDot status={status} />
      <span className="font-mono text-xl leading-none">{value}</span>
      <span className="text-tech text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function Sparkline({ data, status }: { data: { latency: number }[]; status: string }) {
  if (data.length < 2) {
    return (
      <div className="text-tech flex h-full items-center text-[10px] text-muted-foreground">
        geen data
      </div>
    );
  }
  const stroke =
    status === "fail" ? "var(--crit)" : status === "warn" ? "var(--warn)" : "var(--primary)";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line type="monotone" dataKey="latency" stroke={stroke} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
