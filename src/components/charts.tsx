import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--foreground)",
  fontSize: 12,
};

const hourFmt = new Intl.DateTimeFormat("nl-BE", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
const dayFmt = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", timeZone: "Europe/Brussels" });

type Target = { id: string; name: string; kind: string };

/**
 * Reactietijd per site (mediaan per uur, laatste 7 dagen) met uptime-% en haperingen.
 * Kleine veelvouden: één lijn per kaart, dus geen legende nodig; de titel benoemt de site.
 */
export function LatencyGrid({ targets }: { targets: Target[] }) {
  const q = useQuery({
    queryKey: ["latency_hourly", 7],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wt_latency_hourly", { p_days: 7 });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 300_000,
  });
  const rows = q.data ?? [];
  const byTarget = new Map<string, typeof rows>();
  for (const r of rows) byTarget.set(r.target_id, [...(byTarget.get(r.target_id) ?? []), r]);
  const list = targets.filter((t) => byTarget.has(t.id));
  if (q.isLoading) return <div className="panel h-40 animate-pulse" />;
  if (!list.length) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Reactietijd · 7 dagen</h2>
        <span className="text-xs text-muted-foreground">mediaan per uur</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((t) => {
          const pts = (byTarget.get(t.id) ?? []).map((r) => ({ t: Date.parse(r.hour), ms: r.p50_ms, fails: r.fails, checks: r.checks }));
          const checks = pts.reduce((s, p) => s + p.checks, 0);
          const fails = pts.reduce((s, p) => s + p.fails, 0);
          const uptime = checks ? ((checks - fails) / checks) * 100 : 100;
          const sorted = [...pts].map((p) => p.ms).sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
          const failHours = pts.filter((p) => p.fails > 0).length;
          return (
            <Link key={t.id} to="/target/$id" params={{ id: t.id }} className="panel block p-4 transition-colors hover:border-primary/40">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold">{t.name}</span>
                <span
                  className="tabular shrink-0 text-sm font-semibold"
                  style={{ color: uptime >= 99.5 ? "var(--ok)" : uptime >= 98 ? "var(--warn)" : "var(--crit)" }}
                >
                  {uptime >= 99.95 ? "100" : uptime.toFixed(1)}%
                </span>
              </div>
              <div className="tabular mt-0.5 text-xs text-muted-foreground">
                {median} ms mediaan{failHours ? ` · ${failHours} uur met storing` : " · geen storingen"}
              </div>
              <div className="mt-2 h-14">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={pts} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                    <YAxis hide domain={[0, "dataMax"]} />
                    <XAxis dataKey="t" hide type="number" domain={["dataMin", "dataMax"]} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelFormatter={(v) => hourFmt.format(new Date(Number(v)))}
                      formatter={(v: number, _n, item) => [
                        `${v} ms${item?.payload?.fails ? ` · ${item.payload.fails} mislukt` : ""}`,
                        "Reactietijd",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="ms"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      isAnimationActive={false}
                      dot={(p: { cx?: number; cy?: number; payload?: { fails: number }; index?: number }) =>
                        p.payload?.fails ? (
                          <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill="var(--crit)" stroke="var(--card)" strokeWidth={2} />
                        ) : (
                          <g key={p.index} />
                        )
                      }
                      activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const GROUPS = [
  { key: "SellQo & winkels", color: "var(--series-1)" },
  { key: "Ventures", color: "var(--series-2)" },
  { key: "Klantensites", color: "var(--series-3)" },
] as const;

/** Incidenten per week, gestapeld per groep (vaste kleurvolgorde, gevalideerd op het donkere vlak). */
export function IncidentsWeekly() {
  const q = useQuery({
    queryKey: ["incidents_weekly", 8],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wt_incidents_weekly", { p_weeks: 8 });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 600_000,
  });
  const rows = q.data ?? [];
  // 8 weken, ook lege weken tonen zodat de trend eerlijk is.
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7) - 7 * 7);
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(start.getTime() + i * 7 * 86400000);
    const key = d.toISOString().slice(0, 10);
    const entry: Record<string, number | string> = { week: key, label: dayFmt.format(d) };
    for (const g of GROUPS) entry[g.key] = rows.find((r) => r.week === key && r.grp === g.key)?.n ?? 0;
    return entry;
  });
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (q.isLoading) return <div className="panel h-48 animate-pulse" />;

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">Incidenten per week</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {total ? `${total} in de laatste 8 weken` : "Geen incidenten in de laatste 8 weken"}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Legende">
          {GROUPS.map((g) => (
            <span key={g.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[3px]" style={{ background: g.color }} />
              {g.key}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weeks} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgb(255 255 255 / 4%)" }} labelFormatter={(l) => `Week van ${l}`} />
            {GROUPS.map((g, i) => (
              <Bar
                key={g.key}
                dataKey={g.key}
                stackId="a"
                fill={g.color}
                stroke="var(--card)"
                strokeWidth={2}
                radius={i === GROUPS.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
