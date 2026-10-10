import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { IncidentList, useIncidents } from "@/components/incidents";
import { Promises } from "@/components/promises";
import { statusLine } from "@/lib/policy";
import type { CheckStatus } from "@/lib/checks.server";
import {
  CHECK_LABEL,
  KIND_LABEL,
  StatusDot,
  StatusText,
  formatDateTime,
  relativeTime,
} from "@/components/watchtower";

export const Route = createFileRoute("/_authenticated/target/$id")({
  head: () => ({
    meta: [
      { title: "Target — Nomadix Watchtower" },
      { name: "description", content: "Configuratie, scan-historiek en alerts van dit target." },
      { property: "og:title", content: "Target — Nomadix Watchtower" },
      {
        property: "og:description",
        content: "Configuratie, scan-historiek en alerts van dit target.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TargetDetailPage,
});

type Form = {
  name: string;
  url: string;
  frequency: string;
  enabled: boolean;
  checks: Record<string, boolean>;
  form_smoke_url: string;
  health_url: string;
  health_token: string;
  notes: string;
};

function TargetDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [checkFilter, setCheckFilter] = useState("all");

  const targetQuery = useQuery({
    queryKey: ["watch_target", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watch_targets")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const resultsQuery = useQuery({
    queryKey: ["scan_results", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_results")
        .select("*")
        .eq("target_id", id)
        .order("measured_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const summariesQuery = useQuery({
    queryKey: ["daily_summaries", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_summaries")
        .select("*")
        .eq("target_id", id)
        .order("day", { ascending: true })
        .limit(90);
      if (error) throw error;
      return data;
    },
  });

  const alertsQuery = useQuery({
    queryKey: ["alert_log", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_log")
        .select("*")
        .eq("target_id", id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const target = targetQuery.data;
  const incidentsQuery = useIncidents({ targetId: id, includeResolved: true });

  useEffect(() => {
    if (!target || form) return;
    setForm({
      name: target.name,
      url: target.url,
      frequency: target.frequency,
      enabled: target.enabled,
      checks: (target.checks ?? {}) as Record<string, boolean>,
      form_smoke_url: target.form_smoke_url ?? "",
      health_url: target.health_url ?? "",
      health_token: target.health_token ?? "",
      notes: target.notes ?? "",
    });
  }, [target, form]);

  const save = useMutation({
    mutationFn: async (values: Form) => {
      const { error } = await supabase
        .from("watch_targets")
        .update({
          name: values.name.trim(),
          url: values.url.trim(),
          frequency: values.frequency,
          enabled: values.enabled,
          checks: values.checks,
          form_smoke_url: values.form_smoke_url.trim() || null,
          health_url: values.health_url.trim() || null,
          health_token: values.health_token.trim() || null,
          notes: values.notes.trim() || null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watch_target", id] });
      queryClient.invalidateQueries({ queryKey: ["watch_targets"] });
      toast.success("Opgeslagen");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (targetQuery.isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Laden…</p>
      </AppShell>
    );
  }

  if (!target) {
    return (
      <AppShell>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Target niet gevonden.</p>
          <Link to="/dashboard" className="text-sm text-primary hover:underline">
            Terug naar overzicht
          </Link>
        </div>
      </AppShell>
    );
  }

  const results = (resultsQuery.data ?? []).filter(
    (r) => checkFilter === "all" || r.check_key === checkFilter,
  );
  const chartData = (summariesQuery.data ?? []).map((s) => ({
    day: s.day.slice(5),
    uptime: s.uptime_pct === null ? 0 : Number(s.uptime_pct),
  }));

  const checkCfg = (target.checks ?? {}) as Record<string, boolean>;
  const measuredKeys = new Set((resultsQuery.data ?? []).map((r) => r.check_key));
  const enabledCheckKeys = ["store", "http", "health", "ssl", "domain", "dns", "form_smoke"].filter((k) =>
    k === "http" ? checkCfg.http !== false : k === "domain" || k === "store" ? measuredKeys.has(k) : !!checkCfg[k],
  );
  const latestPerCheck = new Map<string, { status: string; summary: string }>();
  for (const r of resultsQuery.data ?? []) {
    if (latestPerCheck.has(r.check_key)) continue;
    latestPerCheck.set(r.check_key, { status: r.status, summary: statusLine(r.check_key, r.status as CheckStatus, r.detail, r.latency_ms) });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3 pt-1">
          <Link to="/dashboard" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
            ‹ Overzicht
          </Link>
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {KIND_LABEL[target.kind] ?? target.kind}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{target.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <StatusText status={target.status} />
            <a href={target.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
              {target.url.replace(/^https?:\/\//, "")}
            </a>
            <span className="text-tech text-[11px] text-muted-foreground">gemeten {relativeTime(target.last_scanned_at)}</span>
          </div>
        </header>

        <Promises targetId={target.id} checks={enabledCheckKeys} latest={latestPerCheck} />

        <section className="space-y-3">
          <h2 className="text-tech text-xs text-muted-foreground">Incidenten</h2>
          <IncidentList
            incidents={(incidentsQuery.data ?? []).slice(0, 10)}
            showTarget={false}
            emptyText="Nog geen incidenten voor dit target."
          />
        </section>

        {form && (
          <details className="panel group p-5"><summary className="cursor-pointer list-none text-tech text-xs text-muted-foreground">Instellingen ▸</summary><section className="mt-5 space-y-5">

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Naam</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">URL</Label>
                <Input
                  id="url"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Frequentie</Label>
                <Select
                  value={form.frequency}
                  onValueChange={(v) => setForm({ ...form, frequency: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Dagelijks</SelectItem>
                    <SelectItem value="weekly">Wekelijks</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between pt-6">
                <Label htmlFor="enabled">Actief</Label>
                <Switch
                  id="enabled"
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Checks</Label>
              {Object.keys(CHECK_LABEL).map((key) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{CHECK_LABEL[key]}</span>
                  <Switch
                    checked={!!form.checks[key]}
                    onCheckedChange={(v) =>
                      setForm({ ...form, checks: { ...form.checks, [key]: v } })
                    }
                  />
                </div>
              ))}
            </div>

            {form.checks.form_smoke && (
              <div className="space-y-2">
                <Label htmlFor="smoke">Formulier smoke-URL</Label>
                <Input
                  id="smoke"
                  value={form.form_smoke_url}
                  onChange={(e) => setForm({ ...form, form_smoke_url: e.target.value })}
                />
              </div>
            )}

            {form.checks.health && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="health_url">Health-URL</Label>
                  <Input
                    id="health_url"
                    value={form.health_url}
                    onChange={(e) => setForm({ ...form, health_url: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="health_token">Health-token</Label>
                  <Input
                    id="health_token"
                    type="password"
                    autoComplete="off"
                    value={form.health_token}
                    onChange={(e) => setForm({ ...form, health_token: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notities</Label>
              <Textarea
                id="notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <Button disabled={save.isPending} onClick={() => save.mutate(form)}>
              {save.isPending ? "Bezig…" : "Opslaan"}
            </Button>
          </section></details>
        )}

        <details className="panel p-5"><summary className="cursor-pointer list-none text-tech text-xs text-muted-foreground">Ruwe metingen en geschiedenis ▸</summary><div className="mt-5 space-y-8">
        <section className="panel fade-in-card p-5">
          <h2 className="text-tech text-xs text-muted-foreground">Uptime-trend (90 dagen)</h2>
          <div className="mt-4 h-56">
            {chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nog geen dagcijfers.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="uptime" fill="var(--chart-1)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-tech text-xs text-muted-foreground">Scan-historiek</h2>
            <div className="ml-auto w-44">
              <Select value={checkFilter} onValueChange={setCheckFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle checks</SelectItem>
                  {Object.entries(CHECK_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-tech border-b border-border text-[10px] text-muted-foreground">
                  <th className="px-4 py-2 text-left">Tijd</th>
                  <th className="px-4 py-2 text-left">Check</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Latency</th>
                  <th className="px-4 py-2 text-left">Detail</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-muted-foreground">
                      Nog geen scans.
                    </td>
                  </tr>
                ) : (
                  results.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-0">
                      <td className="text-tech px-4 py-2 text-[11px] text-muted-foreground">
                        {formatDateTime(r.measured_at)}
                      </td>
                      <td className="px-4 py-2">{CHECK_LABEL[r.check_key] ?? r.check_key}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-2">
                          <StatusDot status={r.status} />
                          <StatusText status={r.status} />
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {r.latency_ms === null ? "—" : `${r.latency_ms} ms`}
                      </td>
                      <td className="max-w-xs truncate px-4 py-2 font-mono text-[11px] text-muted-foreground">
                        {r.detail ? JSON.stringify(r.detail) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-tech text-xs text-muted-foreground">Alert-historiek</h2>
          <div className="panel p-4">
            {(alertsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Geen alerts voor dit target.</p>
            ) : (
              <ul className="space-y-2">
                {(alertsQuery.data ?? []).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <StatusDot status={a.transition.split("->").at(-1) ?? "unknown"} />
                    <span>{CHECK_LABEL[a.check_key] ?? a.check_key}</span>
                    <span className="font-mono text-xs text-muted-foreground">{a.transition}</span>
                    <span className="text-tech ml-auto text-[10px] text-muted-foreground">
                      {formatDateTime(a.created_at)} · {a.mailed ? "gemaild" : "niet gemaild"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        </div></details>
      </div>
    </AppShell>
  );
}
