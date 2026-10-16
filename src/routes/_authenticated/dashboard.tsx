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
import { ProposalRow, ProposalSheet } from "@/components/proposal-detail";
import { RadarOrb } from "@/components/radar-orb";
import { useBaken } from "@/components/baken/baken";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Overzicht — Nomadix Watchtower" },
      {
        name: "description",
        content: "Moet ik vandaag iets doen? Alle Nomadix-properties in één oogopslag.",
      },
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
  const [openProposal, setOpenProposal] = useState<string | null>(null);

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
      toast.success(
        vars.status === "approved"
          ? "Go gegeven — Watchtower voert dit binnen het uur uit (tussen 8u en 22u) en meldt het resultaat"
          : "Afgewezen",
      );
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
      return (data ?? []).filter((r) =>
        seen.has(r.partner) ? false : (seen.add(r.partner), true),
      );
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
  const creditsQuery = useQuery({
    queryKey: ["credit_latest", "teaser"],
    queryFn: async () => {
      const [{ data: rows }, { count }] = await Promise.all([
        supabase.from("credit_latest").select("project_name, exec_s_per_day"),
        supabase
          .from("proposals")
          .select("id", { count: "exact", head: true })
          .like("bundle", "credits-%")
          .eq("status", "proposed"),
      ]);
      const list = (rows ?? []).filter((r) => r.exec_s_per_day != null);
      const total = list.reduce((s, r) => s + Number(r.exec_s_per_day), 0);
      const top = [...list].sort((a, b) => Number(b.exec_s_per_day) - Number(a.exec_s_per_day))[0];
      return { total, top, open: count ?? 0 };
    },
  });
  const engine = useEngineHealth();
  const selftest = useQuery({
    queryKey: ["selftest_latest"],
    queryFn: async () => {
      const { data } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              order: (
                c: string,
                o: object,
              ) => {
                limit: (n: number) => Promise<{
                  data: Array<{
                    ran_at: string;
                    ok: boolean;
                    passed: number;
                    failed: number;
                    results: Array<{ name: string; ok: boolean; detail?: string }>;
                  }> | null;
                }>;
              };
            };
          };
        }
      )
        .from("selftest_runs")
        .select("ran_at, ok, passed, failed, results")
        .order("ran_at", { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    },
    refetchInterval: 300_000,
  });
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
  const rank = (c: string) => (c === "security" ? 0 : c === "bug" ? 1 : 2);
  const topProposals = [...proposals]
    .sort((a, b) => rank(a.category) - rank(b.category) || a.created_at.localeCompare(b.created_at))
    .slice(0, 3);
  // "Weet dit" toont enkel vondsten die ons raken; de onzekere staan op Koppelingen.
  const knowFindings = (findingsQuery.data ?? []).filter((f) => f.impact === "raakt_ons").slice(0, 5);
  const calmNames = targets.filter((t) => !troubled.has(t.id)).map((t) => t.name);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-8">
        <header
          className="rise relative overflow-hidden rounded-[32px] border border-white/10 p-6 md:p-8"
          style={{
            background:
              "radial-gradient(28rem 18rem at 85% 0%, rgb(14 165 233 / 16%), transparent 65%), radial-gradient(24rem 16rem at 0% 100%, rgb(20 184 166 / 14%), transparent 65%), rgb(19 37 61 / 55%)",
            boxShadow: "inset 0 1px 0 0 rgb(255 255 255 / 7%), 0 30px 60px -30px rgb(0 0 0 / 70%)",
          }}
        >
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <BakenHeroButton level={level} />
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]">
                <span style={{ color: LEVEL_COLOR[level] }}>
                  {level === "actie" ? "Actie nodig" : level === "aandacht" ? "Aandacht" : "Rustig"}
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span className="text-muted-foreground">
                  {new Intl.DateTimeFormat("nl-BE", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    timeZone: "Europe/Brussels",
                  }).format(new Date())}
                </span>
              </div>
              <h1
                className={cn(
                  "pb-1 text-[34px] font-extrabold leading-[1.1] tracking-tight md:text-5xl",
                  level === "rustig" && !loading && "brand-text",
                )}
              >
                {loading ? "Even kijken…" : headline}
              </h1>
              {!loading && <p className="mt-2.5 text-[15px] text-muted-foreground">{sub}</p>}
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  to="/proposals"
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-white/10"
                >
                  <span className="tabular font-bold">{proposals.length}</span>{" "}
                  <span className="text-muted-foreground">wachten op go</span>
                </Link>
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-sm font-medium">
                  <span className="tabular font-bold">{targets.length}</span>{" "}
                  <span className="text-muted-foreground">sites bewaakt</span>
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-sm text-muted-foreground">
                  gemeten {relativeTime(lastScan)}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Doe dit: wat vandaag van jou iets vraagt. Acties eerst, dan max 3 voorstellen (security, dan oudste). */}
        {(actie.length > 0 || topProposals.length > 0) && (
          <section className="space-y-3" aria-label="Doe dit">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Doe dit</h2>
              {proposals.length > topProposals.length && (
                <Link to="/proposals" className="text-xs font-medium text-primary">
                  Nog {proposals.length - topProposals.length} voorstellen
                </Link>
              )}
            </div>
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
            {topProposals.length > 0 && (
              <div className="grid gap-2">
                {topProposals.map((p) => (
                  <ProposalRow key={p.id} p={{ ...p, bundle_order: null }} onOpen={setOpenProposal} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Weet dit: kan wachten, maar goed om te weten. */}
        {(aandacht.length > 0 || knowFindings.length > 0) && (
          <section className="space-y-3" aria-label="Weet dit">
            <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Weet dit</h2>
            <div className="panel divide-y divide-border">
              {[...new Set(aandacht.map((i) => i.target_id))].map((targetId) => {
                const items = aandacht.filter((i) => i.target_id === targetId);
                return (
                  <Link
                    key={targetId}
                    to="/target/$id"
                    params={{ id: targetId }}
                    className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-secondary/40"
                  >
                    <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full" style={{ background: "var(--warn)" }} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{items[0].watch_targets?.name}</span>
                      <span className="text-muted-foreground"> · {items.map((i) => i.title).join(" · ")}</span>
                    </span>
                  </Link>
                );
              })}
              {knowFindings.map((f) => (
                <Link key={f.id} to="/koppelingen" className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-secondary/40">
                  <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full" style={{ background: "var(--muted-foreground)" }} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{FINDING_KIND[f.kind] ?? f.kind}</span>
                    <span className="text-muted-foreground"> · {f.title}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Alles goed: één regel, de rest staat op Sites. */}
        {!loading && (
          <Link to="/sites" className="panel flex items-center gap-3 p-4 text-sm transition-colors hover:border-primary/40">
            <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: "var(--ok)" }} />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{calmNames.length} sites zijn rustig</span>
              <span className="block truncate text-muted-foreground">{calmNames.join(", ")}</span>
            </span>
            <span className="shrink-0 text-xs font-medium text-primary">Alle sites</span>
          </Link>
        )}

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
              <span
                className="shrink-0"
                style={{ color: p.upstream_indicator === "minor" ? "var(--warn)" : "var(--crit)" }}
              >
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
            <Link
              to="/koppelingen"
              className="truncate hover:text-foreground"
              style={{ color: eng.warn ? "var(--warn)" : undefined }}
            >
              Radar · {eng.text}
            </Link>
          </div>
          {selftest.data && (
            <div className="flex justify-between gap-4">
              <span
                className="truncate"
                style={{ color: selftest.data.ok ? undefined : "var(--warn)" }}
                title={selftest.data.results
                  .filter((r) => !r.ok)
                  .map((r) => `${r.name}: ${r.detail ?? ""}`)
                  .join("\n")}
              >
                Zelftest ·{" "}
                {selftest.data.ok
                  ? `alle ${selftest.data.passed} functies werken`
                  : `${selftest.data.failed} kapot: ${selftest.data.results
                      .filter((r) => !r.ok)
                      .map((r) => r.name)
                      .join(", ")}`}
              </span>
              <span className="shrink-0">{relativeTime(selftest.data.ran_at)}</span>
            </div>
          )}
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
      <ProposalSheet id={openProposal} onOpenChange={setOpenProposal} />
    </AppShell>
  );
}

/** Het oog op Vandaag is meteen de knop naar Baken. */
function BakenHeroButton({ level }: { level: "rustig" | "aandacht" | "actie" }) {
  const { open } = useBaken();
  return (
    <button
      type="button"
      onClick={open}
      className="group relative w-32 shrink-0 md:w-40"
      aria-label="Praat met Baken"
    >
      <RadarOrb
        level={level}
        className="w-full transition-transform duration-300 group-hover:scale-105 group-active:scale-95"
      />
      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-[#0b1a2e]/85 px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-[#22d3ee] backdrop-blur">
        Praat met Baken
      </span>
    </button>
  );
}
