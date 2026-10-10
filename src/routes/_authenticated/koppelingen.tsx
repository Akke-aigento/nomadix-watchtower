import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/components/watchtower";
import { cn } from "@/lib/utils";
import { FindingCard, TOUCH, TouchpointChips, engineLine, useEngineHealth, type Finding } from "@/components/findings";

export const Route = createFileRoute("/_authenticated/koppelingen")({
  head: () => ({ meta: [{ title: "Koppelingen — Nomadix Watchtower" }] }),
  component: KoppelingenPage,
});

const CATEGORY: Record<string, string> = {
  marketplace: "Marketplaces",
  payments: "Betalingen",
  accounting: "Boekhouding",
  shipping: "Verzending",
  fulfilment: "Fulfilment",
  mail: "Mail",
  ai: "AI",
  infra: "Infrastructuur",
  push: "Push",
  social: "Social",
  reviews: "Reviews",
  compliance: "Compliance",
  other: "Overig",
  unclassified: "Zelf ontdekt — nog te classificeren",
};

const RISK_COLOR: Record<string, string> = { actie: "var(--crit)", aandacht: "var(--warn)", ok: "var(--ok)" };

const UPSTREAM: Record<string, [string, string]> = {
  none: ["operationeel", "var(--ok)"],
  minor: ["kleine storing", "var(--warn)"],
  major: ["storing", "var(--crit)"],
  critical: ["zware storing", "var(--crit)"],
  maintenance: ["onderhoud", "var(--warn)"],
};

function KoppelingenPage() {
  const [open, setOpen] = useState<string | null>(null);
  const [onlyActive, setOnlyActive] = useState(false);

  const q = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("integrations").select("*").order("partner");
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 120_000,
  });

  const usages = useQuery({
    queryKey: ["integration_usages", open],
    enabled: !!open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_usages")
        .select("repo, file, version, occurrences, kind")
        .eq("integration_key", open!)
        .order("file");
      if (error) throw error;
      return data ?? [];
    },
  });

  const findingsQ = useQuery({
    queryKey: ["findings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("findings").select("*").order("detected_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Finding[];
    },
    refetchInterval: 120_000,
  });
  const coverageQ = useQuery({
    queryKey: ["radar_coverage"],
    queryFn: async () => {
      const { data, error } = await supabase.from("radar_coverage").select("key, due, review_days_effective");
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.key, r]));
    },
    refetchInterval: 300_000,
  });
  const engine = useEngineHealth();
  const eng = engineLine(engine.data);
  const findings = findingsQ.data ?? [];
  const openFindings = findings.filter((f) => f.status === "nieuw" && f.impact !== "raakt_ons_niet");
  const recentFindings = findings.filter((f) => f.status !== "nieuw" || f.impact === "raakt_ons_niet").slice(0, 5);

  const all = q.data ?? [];
  const list = onlyActive ? all.filter((i) => i.usage_state === "active") : all;
  const risky = all.filter((i) => i.risk !== "ok");
  const degraded = all.filter((i) => i.usage_state === "active" && ["minor", "major", "critical"].includes(i.upstream_indicator ?? ""));
  const discovered = all.filter((i) => i.discovered_via !== "manual" && Date.now() - Date.parse(i.discovered_at) < 7 * 86400000);
  const cats = [...new Set(list.map((i) => i.category))].sort((a, b) =>
    a === "unclassified" ? 1 : b === "unclassified" ? -1 : (CATEGORY[a] ?? a).localeCompare(CATEGORY[b] ?? b, "nl"),
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Koppelingen</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Elke partner waar onze code mee praat — zelf ontdekt in de repo's en de SellQo-data — met waar hij
            overal in de keten opduikt: code, beheerschermen, marketing en helpartikels.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat n={all.length} label="koppelingen" />
            <Stat n={all.filter((i) => i.usage_state === "active").length} label="in gebruik" />
            <Stat n={risky.length} label="met risico" color={risky.length ? "var(--warn)" : undefined} />
            <Stat n={openFindings.length} label="open vondsten" color={openFindings.length ? "var(--warn)" : undefined} />
            <Stat n={degraded.length} label="partner in storing" color={degraded.length ? "var(--crit)" : undefined} />
          </div>
          <p className="mt-3 text-sm" style={{ color: eng.warn ? "var(--warn)" : undefined }}>
            <span className="text-muted-foreground">Radar · </span>
            {eng.text}
          </p>
        </header>

        {openFindings.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-tech text-xs text-muted-foreground">Vondsten die nog een pakket of besluit nodig hebben</h2>
            <div className="space-y-2">
              {openFindings.map((f) => (
                <FindingCard key={f.id} f={f} partner={all.find((i) => i.key === f.integration_key)?.name} />
              ))}
            </div>
          </section>
        )}

        {recentFindings.length > 0 && (
          <details className="panel px-4 py-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Recent verwerkte vondsten ({recentFindings.length})</summary>
            <div className="mt-3 space-y-2">
              {recentFindings.map((f) => (
                <FindingCard key={f.id} f={f} partner={all.find((i) => i.key === f.integration_key)?.name} />
              ))}
            </div>
          </details>
        )}

        {degraded.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-tech text-xs text-muted-foreground">Partners nu in storing</h2>
            <div className="panel divide-y divide-border">
              {degraded.map((i) => (
                <div key={i.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="font-medium">{i.partner}</span>
                  <span style={{ color: UPSTREAM[i.upstream_indicator!]?.[1] }}>{i.upstream_description}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {discovered.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Deze week zelf ontdekt: {discovered.map((i) => i.name).join(", ")}.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          Enkel koppelingen die echt in gebruik zijn
        </label>

        {cats.map((cat) => (
          <section key={cat} className="space-y-2">
            <h2 className="text-tech text-xs text-muted-foreground">{CATEGORY[cat] ?? cat}</h2>
            <div className="panel divide-y divide-border">
              {list
                .filter((i) => i.category === cat)
                .map((i) => (
                  <div key={i.key}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-secondary/40"
                      onClick={() => setOpen(open === i.key ? null : i.key)}
                      aria-expanded={open === i.key}
                    >
                      <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full" style={{ background: RISK_COLOR[i.risk] }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="font-medium">{i.name}</span>
                          <span className="text-tech text-xs text-muted-foreground">
                            {i.usage_state === "active"
                              ? `in gebruik${i.active_tenants ? ` · ${i.active_tenants} tenant(s)` : ""}`
                              : i.usage_state === "dormant"
                                ? "in code, niet in gebruik"
                                : "gebruik onbekend"}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {i.used_version && <span>versie: {i.used_version}</span>}
                          {i.latest_version && i.latest_version !== i.used_version && <span>nieuwste: {i.latest_version}</span>}
                          {i.upstream_indicator && UPSTREAM[i.upstream_indicator] && (
                            <span style={{ color: UPSTREAM[i.upstream_indicator][1] }}>
                              status: {UPSTREAM[i.upstream_indicator][0]}
                            </span>
                          )}
                          {coverageQ.data?.get(i.key)?.due && i.usage_state === "active" && (
                            <span style={{ color: "var(--warn)" }}>radar te doen</span>
                          )}
                          {findings.some((f) => f.integration_key === i.key && f.status === "nieuw" && f.impact !== "raakt_ons_niet") && (
                            <span style={{ color: "var(--warn)" }}>open vondst</span>
                          )}
                          <TouchpointChips touchpoints={i.touchpoints} />
                        </div>
                        {i.risk_note && <p className={cn("mt-1 text-sm", i.risk === "ok" ? "text-muted-foreground" : "")}>{i.risk_note}</p>}
                      </div>
                    </button>
                    {open === i.key && (
                      <div className="space-y-2 bg-secondary/30 px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-3 text-xs">
                          {i.docs_url && <a className="underline-offset-4 hover:underline" href={i.docs_url} target="_blank" rel="noreferrer">docs</a>}
                          {i.changelog_url && <a className="underline-offset-4 hover:underline" href={i.changelog_url} target="_blank" rel="noreferrer">changelog</a>}
                          {i.status_page_url && <a className="underline-offset-4 hover:underline" href={i.status_page_url} target="_blank" rel="noreferrer">statuspagina</a>}
                          {i.pricing_url && <a className="underline-offset-4 hover:underline" href={i.pricing_url} target="_blank" rel="noreferrer">prijzen</a>}
                          <span className="text-muted-foreground">
                            ontdekt via {i.discovered_via} · laatst gezien {relativeTime(i.last_seen_at)}
                            {i.radar_checked_at ? ` · radar ${relativeTime(i.radar_checked_at)}` : ""}
                          </span>
                        </div>
                        {i.notes && <p className="text-muted-foreground">{i.notes}</p>}
                        {i.radar_note && (
                          <p className="text-muted-foreground">
                            <span className="text-tech text-[10px]">Radar</span> {i.radar_note}
                          </p>
                        )}
                        {findings
                          .filter((f) => f.integration_key === i.key)
                          .map((f) => (
                            <FindingCard key={f.id} f={f} className="bg-background/40" />
                          ))}
                        {usages.isLoading ? (
                          <p className="text-muted-foreground">Laden…</p>
                        ) : (usages.data ?? []).length ? (
                          <div className="max-h-96 space-y-3 overflow-y-auto">
                            {TOUCH.map(([kind, label]) => {
                              const rows = (usages.data ?? []).filter((u) => u.kind === kind);
                              if (!rows.length) return null;
                              return (
                                <div key={kind}>
                                  <div className="text-tech mb-1 text-[10px] text-muted-foreground">
                                    {label} · {rows.length}
                                  </div>
                                  <ul className="space-y-1 font-mono text-xs">
                                    {rows.map((u) => (
                                      <li key={`${u.repo}/${u.file}/${u.version}/${u.kind}`} className="flex justify-between gap-3">
                                        <span className="truncate">
                                          {u.repo}/{u.file}
                                        </span>
                                        <span className="shrink-0 text-muted-foreground">
                                          {u.version ? `${u.version} · ` : ""}
                                          {u.occurrences}×
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-muted-foreground">Geen codegebruik geregistreerd.</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color?: string }) {
  return (
    <div className="panel px-3 py-2.5">
      <div className="text-2xl font-semibold leading-none" style={color ? { color } : undefined}>
        {n}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
