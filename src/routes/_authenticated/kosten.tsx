import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, Clock, Database, Radio, Sparkles } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/components/watchtower";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/kosten")({
  head: () => ({ meta: [{ title: "Credits — Nomadix Watchtower" }] }),
  component: KostenPage,
});

type Saving = { title: string; action: string; impact: "laag" | "midden" | "hoog"; risk: string };
type Cron = { job: string; schedule: string; runs_24h?: number };

const IMPACT_COLOR: Record<string, string> = { hoog: "var(--ok)", midden: "var(--primary)", laag: "var(--muted-foreground)" };
const IDLE_S = 2;

function fmtS(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 100) return `${Math.round(n)} s`;
  if (n >= 10) return `${n.toFixed(0)} s`;
  return `${n.toFixed(1)} s`;
}

function KostenPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);

  const latest = useQuery({
    queryKey: ["credit_latest"],
    queryFn: async () => {
      const { data, error } = await supabase.from("credit_latest").select("*");
      if (error) throw error;
      return (data ?? []).sort((a, b) => (b.exec_s_per_day ?? -1) - (a.exec_s_per_day ?? -1));
    },
  });

  const proposals = useQuery({
    queryKey: ["proposals", "credits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("id, title, description, proposed_action, status, bundle_order, result")
        .like("bundle", "credits-%")
        .order("bundle_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase.from("proposals").update({ status, decided_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      queryClient.invalidateQueries({ queryKey: ["nav_badges"] });
      toast.success(v.status === "approved" ? "Go gegeven — Watchtower pakt dit op bij de volgende ronde" : "Afgewezen");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = latest.data ?? [];
  const busy = rows.filter((r) => (r.exec_s_per_day ?? 0) > IDLE_S);
  const idle = rows.filter((r) => (r.exec_s_per_day ?? 0) <= IDLE_S);
  const total = busy.reduce((s, r) => s + Number(r.exec_s_per_day ?? 0), 0);
  const top = busy[0];
  const topShare = top && total ? Math.round((Number(top.exec_s_per_day) / total) * 100) : 0;
  const takenAt = rows.map((r) => r.taken_at).sort().at(-1);
  const chartData = busy.map((r) => ({ name: r.project_name, s: Math.round(Number(r.exec_s_per_day ?? 0)) }));
  const open_ = (proposals.data ?? []).filter((p) => p.status === "proposed");
  const rest = (proposals.data ?? []).filter((p) => p.status !== "proposed");

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-8">
        <PageHeader
          eyebrow="Credits"
          title="Waar je credits naartoe gaan"
          subtitle={
            <>
              Lovable rekent Cloud-credits op databaseactiviteit, niet op het bestaan van een project. Watchtower meet daarom de
              rekentijd per project per dag en zoekt wat goedkoper kan. Gemeten {relativeTime(takenAt)}.
            </>
          }
        />

        {latest.isLoading ? (
          <div className="panel h-48 animate-pulse" />
        ) : rows.length === 0 ? (
          <div className="panel p-6 text-sm text-muted-foreground">Nog geen meting. De eerstvolgende Watchtower-ronde vult dit in.</div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="panel p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Rekentijd per dag</div>
                <div className="tabular mt-2 text-3xl font-bold">{fmtS(total)}</div>
                <div className="mt-1 text-sm text-muted-foreground">over {busy.length} actieve projecten</div>
              </div>
              <div className="panel p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Grootste verbruiker</div>
                <div className="mt-2 truncate text-xl font-bold">{top?.project_name ?? "—"}</div>
                <div className="tabular mt-1 text-sm text-muted-foreground">{topShare}% van alle rekentijd</div>
              </div>
              <div className="panel p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Besparingen klaar</div>
                <div className="tabular mt-2 text-3xl font-bold">{open_.length}</div>
                <div className="mt-1 text-sm text-muted-foreground">wachten op jouw go</div>
              </div>
            </section>

            <section className="panel p-5">
              <h2 className="text-[15px] font-semibold">Database-rekentijd per project</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Seconden per dag, gemiddeld sinds de laatste reset van de meting.</p>
              <div className="mt-4" style={{ height: Math.max(160, chartData.length * 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={8}>
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={150}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 13 }}
                    />
                    <Tooltip
                      cursor={{ fill: "rgb(255 255 255 / 4%)" }}
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--foreground)" }}
                      formatter={(v: number) => [`${v} s per dag`, "Rekentijd"]}
                    />
                    <Bar dataKey="s" fill="var(--primary)" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      <LabelList dataKey="s" position="right" formatter={(v: number) => `${v} s`} fill="var(--foreground)" fontSize={12} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {idle.length > 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Rustig (≤ {IDLE_S} s/dag): {idle.map((r) => r.project_name).join(", ")}.
                </p>
              )}
            </section>
          </>
        )}

        {open_.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Besparingen — wacht op jouw go</h2>
            {open_.map((p) => (
              <article key={p.id} className="panel p-5">
                <h3 className="font-semibold">{p.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                <p className="mt-2 text-sm">{p.proposed_action}</p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, status: "approved" })}>
                    Go
                  </Button>
                  <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, status: "rejected" })}>
                    Afwijzen
                  </Button>
                </div>
              </article>
            ))}
          </section>
        )}

        {busy.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Per project: wat kost er</h2>
            {busy.map((r) => {
              const crons = (r.crons as Cron[] | null) ?? [];
              const savings = (r.savings as Saving[] | null) ?? [];
              const isOpen = open === r.lovable_project_id;
              return (
                <div key={r.lovable_project_id} className="panel overflow-hidden">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-5 py-4 text-left"
                    onClick={() => setOpen(isOpen ? null : r.lovable_project_id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.project_name}</span>
                      <span className="block truncate text-sm text-muted-foreground">{r.drivers?.[0]}</span>
                    </span>
                    <span className="tabular shrink-0 text-sm font-semibold">{fmtS(Number(r.exec_s_per_day))}/dag</span>
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                  </button>
                  {isOpen && (
                    <div className="space-y-4 border-t border-border px-5 py-4 text-sm">
                      <ul className="space-y-1.5">
                        {(r.drivers ?? []).map((d) => (
                          <li key={d} className="flex gap-2">
                            <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                      {crons.length > 0 && (
                        <div>
                          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                            <Clock className="size-3.5" /> Crons
                          </div>
                          <div className="divide-y divide-border rounded-xl border border-border">
                            {crons.map((c) => (
                              <div key={c.job} className="flex items-center gap-3 px-3 py-2">
                                <span className="min-w-0 flex-1 truncate">{c.job}</span>
                                <code className="font-mono text-xs text-muted-foreground">{c.schedule}</code>
                                {c.runs_24h != null && <span className="tabular w-16 text-right text-xs">{c.runs_24h}×/dag</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(r.realtime_tables ?? []).length > 0 && (
                        <div className="flex gap-2 text-muted-foreground">
                          <Radio className="mt-0.5 size-4 shrink-0" />
                          <span>Realtime op: {(r.realtime_tables ?? []).join(", ")}</span>
                        </div>
                      )}
                      {savings.length > 0 && (
                        <div>
                          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                            <Sparkles className="size-3.5" /> Zo kan het goedkoper
                          </div>
                          <ul className="space-y-2">
                            {savings.map((s) => (
                              <li key={s.title} className="rounded-xl bg-secondary/60 px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{s.title}</span>
                                  <span className="ml-auto text-xs font-semibold" style={{ color: IMPACT_COLOR[s.impact] }}>
                                    winst {s.impact}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-muted-foreground">{s.action}</div>
                                <div className="mt-0.5 text-xs text-muted-foreground">Risico: {s.risk}</div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {rest.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Al beslist</h2>
            {rest.map((p) => (
              <div key={p.id} className="flex items-start gap-3 rounded-xl px-1 py-1 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.title}</span>
                  {p.result && <span className="block text-muted-foreground">{p.result}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.status}</span>
              </div>
            ))}
          </section>
        )}

        <p className="border-t border-border pt-4 text-sm text-muted-foreground">
          Wat Watchtower (nog) niet ziet: credits voor bouwberichten aan de Lovable-agent en AI-verbruik via de gateway. Die toont enkel
          Lovable zelf, in het verbruiksoverzicht van je workspace. Zet daar per project een creditalert; Watchtower houdt de rest bij.
        </p>
      </div>
    </AppShell>
  );
}
