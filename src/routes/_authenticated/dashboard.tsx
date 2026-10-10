import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { IncidentList, isAcknowledged, useIncidents } from "@/components/incidents";
import { CategoryBadge, formatDateTime, relativeTime } from "@/components/watchtower";
import { cn } from "@/lib/utils";
import { FINDING_KIND, engineLine, useEngineHealth } from "@/components/findings";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Overzicht — Nomadix Watchtower" },
      { name: "description", content: "Moet ik vandaag iets doen? Alle Nomadix-properties in één oogopslag." },
    ],
  }),
  component: DashboardPage,
});

type Level = "actie" | "aandacht" | "rustig";

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

function DashboardPage() {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);

  const targetsQuery = useQuery({
    queryKey: ["watch_targets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("watch_targets").select("*").eq("enabled", true).order("name");
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });

  const proposalsQuery = useQuery({
    queryKey: ["proposals", "open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("*")
        .eq("status", "proposed")
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
      toast.success(vars.status === "approved" ? "Go gegeven — Claude pakt dit op bij de volgende ronde (rond 8u, 13u of 19u)" : "Afgewezen");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const partnersQuery = useQuery({
    queryKey: ["partners_degraded"],
    queryFn: async () => {
      const { data } = await supabase
        .from("integrations")
        .select("partner, upstream_indicator, upstream_description")
        .eq("usage_state", "active")
        .in("upstream_indicator", ["minor", "major", "critical"]);
      const seen = new Set<string>();
      return (data ?? []).filter((r) => (seen.has(r.partner) ? false : (seen.add(r.partner), true)));
    },
    refetchInterval: 120_000,
  });
  const findingsQuery = useQuery({
    queryKey: ["findings", "open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("findings")
        .select("id, title, kind, severity, impact, integration_key, bundle, status, detected_at")
        .eq("status", "nieuw")
        .neq("impact", "raakt_ons_niet")
        .order("detected_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 120_000,
  });
  const engine = useEngineHealth();
  const eng = engineLine(engine.data);
  const incidentsQuery = useIncidents();
  const targets = targetsQuery.data ?? [];
  const incidents = incidentsQuery.data ?? [];
  const active = incidents.filter((i) => !isAcknowledged(i) && i.severity !== "monitor");
  const acked = incidents.filter((i) => isAcknowledged(i));
  const monitor = incidents.filter((i) => i.severity === "monitor");
  const actie = active.filter((i) => i.severity === "actie");
  const aandacht = active.filter((i) => i.severity === "aandacht");

  const levelOf = (targetId: string): string => {
    const mine = incidents.filter((i) => i.target_id === targetId && i.severity !== "monitor");
    if (mine.some((i) => i.severity === "actie" && !isAcknowledged(i))) return "actie";
    if (mine.some((i) => i.severity === "aandacht" && !isAcknowledged(i))) return "aandacht";
    if (mine.some((i) => isAcknowledged(i))) return "erkend";
    const t = targets.find((x) => x.id === targetId);
    return t?.status === "unknown" ? "onbekend" : "rustig";
  };

  const level: Level = actie.length ? "actie" : aandacht.length ? "aandacht" : "rustig";
  const troubled = new Set(active.map((i) => i.target_id));
  const actieTargets = new Set(actie.map((i) => i.target_id)).size;
  const aandachtTargets = new Set(aandacht.map((i) => i.target_id)).size;
  const headline =
    level === "actie"
      ? `${actieTargets === 1 ? "1 property vraagt" : `${actieTargets} properties vragen`} actie`
      : level === "aandacht"
        ? `${aandachtTargets === 1 ? "1 property vraagt" : `${aandachtTargets} properties vragen`} aandacht`
        : "Alles rustig";
  const sub =
    level === "rustig"
      ? `${targets.length} properties, alle beloftes gehouden.`
      : `${targets.length - troubled.size} van de ${targets.length} properties zijn rustig.`;
  const lastScan = targets
    .map((t) => t.last_scanned_at)
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined;

  const loading = targetsQuery.isLoading || incidentsQuery.isLoading;
  const proposals = proposalsQuery.data ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="pt-2">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-full" style={{ background: LEVEL_COLOR[level] }} />
            <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: LEVEL_COLOR[level] }}>
              {level === "actie" ? "Actie" : level === "aandacht" ? "Aandacht" : "Rustig"}
            </span>
            <span className="text-tech ml-auto text-[11px] text-muted-foreground">
              gemeten {relativeTime(lastScan)}
            </span>
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
            {loading ? "Even kijken…" : headline}
          </h1>
          {!loading && <p className="mt-2 text-[15px] text-muted-foreground">{sub}</p>}
        </header>

        {actie.length > 0 && (
          <section className="space-y-3" aria-label="Actie">
            {actie.map((i) => (
              <Link
                key={i.id}
                to="/target/$id"
                params={{ id: i.target_id }}
                className="block rounded-2xl border border-[var(--crit)]/40 bg-[var(--crit)]/8 p-5 transition-colors hover:bg-[var(--crit)]/12"
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="font-semibold">{i.watch_targets?.name}</span>
                  <span className="text-tech text-xs text-[var(--crit)]">sinds {formatDateTime(i.opened_at)}</span>
                </div>
                <p className="text-[15px]">{i.title}</p>
                {i.summary && <p className="mt-1 text-sm text-muted-foreground">{i.summary}</p>}
              </Link>
            ))}
          </section>
        )}

        {aandacht.length > 0 && (
          <section className="space-y-3" aria-label="Aandacht">
            {[...new Set(aandacht.map((i) => i.target_id))].map((targetId) => {
              const items = aandacht.filter((i) => i.target_id === targetId);
              return (
                <Link
                  key={targetId}
                  to="/target/$id"
                  params={{ id: targetId }}
                  className="block rounded-2xl border border-[var(--warn)]/30 bg-[var(--warn)]/6 p-5 transition-colors hover:bg-[var(--warn)]/10"
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="font-semibold">{items[0].watch_targets?.name}</span>
                    <span className="text-xs font-semibold text-[var(--warn)]">Aandacht</span>
                  </div>
                  {items.map((i) => (
                    <p key={i.id} className="text-sm text-muted-foreground">
                      <span className="text-foreground">{i.title}</span>
                      {i.summary ? ` — ${i.summary}` : ""}
                    </p>
                  ))}
                </Link>
              );
            })}
          </section>
        )}

        {(findingsQuery.data ?? []).length > 0 && (
          <section className="space-y-3">
            <h2 className="text-tech text-xs text-muted-foreground">Gevonden bij partners — wordt uitgewerkt tot pakket</h2>
            <div className="panel divide-y divide-border">
              {(findingsQuery.data ?? []).map((f) => (
                <Link key={f.id} to="/koppelingen" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-secondary/40">
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: f.severity === "actie" ? "var(--crit)" : f.severity === "aandacht" ? "var(--warn)" : "var(--muted-foreground)" }}
                  />
                  <span className="min-w-0 flex-1 truncate">{f.title}</span>
                  <span className="text-tech shrink-0 text-[10px] text-muted-foreground">{FINDING_KIND[f.kind] ?? f.kind}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {proposals.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-tech text-xs text-muted-foreground">Wacht op jouw go</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {proposals.map((p) => (
                <article key={p.id} className="panel p-4">
                  <div className="flex items-center gap-2">
                    <CategoryBadge category={p.category} />
                    <span className="text-tech text-[10px] text-muted-foreground">{relativeTime(p.created_at)}</span>
                  </div>
                  <h3 className="mt-2 font-medium">{p.title}</h3>
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{p.proposed_action}</p>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, status: "approved" })}>
                      Go
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: p.id, status: "rejected" })}
                    >
                      Afwijzen
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-6">
          {GROUPS.map((g) => {
            const list = targets.filter((t) => g.kinds.includes(t.kind));
            if (!list.length) return null;
            const calm = list.filter((t) => levelOf(t.id) === "rustig").length;
            const parts = [
              `${calm} rustig`,
              ...(["actie", "aandacht", "erkend"] as const)
                .map((lv) => [lv, list.filter((t) => levelOf(t.id) === lv).length] as const)
                .filter(([, n]) => n > 0)
                .map(([lv, n]) => `${n} ${lv}`),
            ];
            return (
              <div key={g.name}>
                <div className="mb-2.5 flex items-baseline justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.name}</h2>
                  <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {list.map((t) => {
                    const lv = levelOf(t.id);
                    return (
                      <Link
                        key={t.id}
                        to="/target/$id"
                        params={{ id: t.id }}
                        className={cn(
                          "flex min-h-11 items-center gap-2.5 rounded-xl border border-transparent bg-card px-3 py-2.5 transition-colors hover:border-border",
                        )}
                      >
                        <span
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ background: LEVEL_COLOR[lv] }}
                          aria-label={lv}
                        />
                        <span className="truncate text-sm font-medium">{t.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <footer className="space-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
          {acked.map((i) => (
            <div key={i.id} className="flex justify-between gap-4">
              <span className="truncate">
                Erkend · {i.watch_targets?.name} — {i.title}
              </span>
              <span className="shrink-0">tot {formatDateTime(i.acknowledged_until)}</span>
            </div>
          ))}
          {(partnersQuery.data ?? []).map((p) => (
            <div key={p.partner} className="flex justify-between gap-4">
              <Link to="/koppelingen" className="truncate hover:text-foreground">
                Partner · {p.partner} — {p.upstream_description}
              </Link>
              <span className="shrink-0" style={{ color: p.upstream_indicator === "minor" ? "var(--warn)" : "var(--crit)" }}>
                {p.upstream_indicator === "minor" ? "kleine storing" : "storing"}
              </span>
            </div>
          ))}
          <div className="flex justify-between gap-4">
            <span>
              Zelfcontrole ·{" "}
              {monitor.length
                ? `${monitor.length} meting(en) lukken al een tijd niet`
                : "alle metingen in orde"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <Link to="/koppelingen" className="truncate hover:text-foreground" style={{ color: eng.warn ? "var(--warn)" : undefined }}>
              Radar · {eng.text}
            </Link>
          </div>
          <button
            type="button"
            className="pt-2 text-xs underline-offset-4 hover:underline"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Verberg alle open incidenten" : "Toon alle open incidenten (ook erkend)"}
          </button>
        </footer>

        {showAll && <IncidentList incidents={incidents} emptyText="Geen open incidenten." />}
      </div>
    </AppShell>
  );
}
