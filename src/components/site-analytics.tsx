import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Globe2,
  Monitor,
  MousePointerClick,
  Smartphone,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];
type Pair = [string, number];

const dayFmt = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short" });
const TOOLTIP = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--foreground)",
  fontSize: 12,
};

function isoDay(offset: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function flag(cc: string) {
  if (!/^[A-Z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

const COUNTRY = new Intl.DisplayNames(["nl"], { type: "region" });
function countryName(cc: string) {
  try {
    return /^[A-Z]{2}$/.test(cc) ? (COUNTRY.of(cc) ?? cc) : "Onbekend";
  } catch {
    return cc;
  }
}

function Delta({ now, prev }: { now: number; prev: number | null }) {
  if (prev == null) return null;
  if (prev === 0 && now === 0) return <span className="text-xs text-muted-foreground">gelijk</span>;
  const pct = prev === 0 ? 100 : Math.round(((now - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold",
        up ? "text-[var(--ok)]" : "text-[#fb7185]",
      )}
    >
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(pct)}%
    </span>
  );
}

function TopList({
  title,
  icon: Icon,
  rows,
  render,
}: {
  title: string;
  icon: typeof Users;
  rows: Pair[];
  render?: (label: string) => React.ReactNode;
}) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <section className="panel p-4">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="size-3.5" /> {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nog geen data.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 8).map(([label, value]) => (
            <li key={label} className="relative overflow-hidden rounded-lg px-2.5 py-1.5 text-sm">
              <span
                className="absolute inset-y-0 left-0 rounded-lg bg-[#3987e5]/20"
                style={{ width: `${(value / max) * 100}%` }}
                aria-hidden
              />
              <span className="relative flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{render ? render(label) : label}</span>
                <span className="tabular shrink-0 font-semibold">{value}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Bezoekers van één site: periode kiezen, kerncijfers met vergelijking, verloop en toplijsten. */
export function SiteAnalytics({ targetId }: { targetId: string }) {
  const [period, setPeriod] = useState<Period>(30);

  const daily = useQuery({
    queryKey: ["site_analytics_daily", targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_analytics_daily")
        .select("day, visitors, pageviews, bounce_rate, session_min")
        .eq("target_id", targetId)
        .gte("day", isoDay(95))
        .order("day");
      if (error) throw error;
      return data ?? [];
    },
  });
  const lists = useQuery({
    queryKey: ["site_analytics_lists", targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_analytics_lists")
        .select("*")
        .eq("target_id", targetId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = daily.data ?? [];
  if (daily.isLoading) return <div className="panel h-64 animate-pulse" />;
  if (!rows.length)
    return (
      <section id="bezoekers" className="panel p-5 text-sm text-muted-foreground">
        Nog geen bezoekersdata voor deze site. Watchtower haalt ze elke ochtend op bij Lovable.
      </section>
    );

  const from = isoDay(period - 1);
  const prevFrom = isoDay(period * 2 - 1);
  const cur = rows.filter((r) => r.day >= from).sort((a, b) => a.day.localeCompare(b.day));
  const prev = rows.filter((r) => r.day >= prevFrom && r.day < from);
  const sum = (a: typeof rows, k: "visitors" | "pageviews") =>
    a.reduce((s, r) => s + (r[k] ?? 0), 0);
  const v = sum(cur, "visitors");
  const pv = sum(cur, "pageviews");
  const hasPrev = period < 90 && prev.length >= period - 1;
  const bounce = v ? cur.reduce((s, r) => s + Number(r.bounce_rate ?? 0) * r.visitors, 0) / v : 0;
  const prevBounceV = sum(prev, "visitors");
  const prevBounce = prevBounceV
    ? prev.reduce((s, r) => s + Number(r.bounce_rate ?? 0) * r.visitors, 0) / prevBounceV
    : null;
  const chart = cur.map((r) => ({
    t: r.day,
    label: dayFmt.format(new Date(r.day)),
    Bezoekers: r.visitors,
    Paginaweergaven: r.pageviews,
  }));
  const l = (lists.data ?? []).find((x) => x.period_days === period);
  const pages = (l?.pages as Pair[] | undefined) ?? [];
  const sources = (l?.sources as Pair[] | undefined) ?? [];
  const devices = (l?.devices as Pair[] | undefined) ?? [];
  const countries = (l?.countries as Pair[] | undefined) ?? [];
  const best = [...cur].sort((a, b) => b.visitors - a.visitors)[0];

  const tiles = [
    {
      label: "Bezoekers",
      value: v,
      delta: <Delta now={v} prev={hasPrev ? sum(prev, "visitors") : null} />,
    },
    {
      label: "Paginaweergaven",
      value: pv,
      delta: <Delta now={pv} prev={hasPrev ? sum(prev, "pageviews") : null} />,
    },
    { label: "Pagina's per bezoek", value: v ? (pv / v).toFixed(1) : "—", delta: null },
    {
      label: "Haakt meteen af",
      value: v ? `${Math.round(bounce)}%` : "—",
      delta:
        hasPrev && prevBounce != null ? (
          <span className="text-xs text-muted-foreground">was {Math.round(prevBounce)}%</span>
        ) : null,
    },
  ];

  return (
    <section id="bezoekers" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Bezoekers</h2>
          <p className="text-sm text-muted-foreground">
            {best && best.visitors > 0
              ? `Drukste dag: ${dayFmt.format(new Date(best.day))} met ${best.visitors} bezoekers.`
              : "Rustig in deze periode."}
          </p>
        </div>
        <div
          className="flex rounded-full border border-white/10 bg-white/[0.04] p-1"
          role="tablist"
          aria-label="Periode"
        >
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                "tabular rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all",
                period === p ? "text-[#06202c]" : "text-muted-foreground hover:text-foreground",
              )}
              style={
                period === p
                  ? { background: "linear-gradient(135deg,#2dd4bf,#22d3ee 55%,#38bdf8)" }
                  : undefined
              }
            >
              {p} d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="panel p-4">
            <div className="text-xs font-semibold text-muted-foreground">{t.label}</div>
            <div className="tabular mt-1.5 text-2xl font-bold">{t.value}</div>
            <div className="mt-0.5 h-4">{t.delta}</div>
          </div>
        ))}
      </div>

      <div className="panel p-4 md:p-5">
        <div
          className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground"
          aria-label="Legende"
        >
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[#3987e5]" /> Bezoekers
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[#d55181]" /> Paginaweergaven
          </span>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="sa-v" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#3987e5" stopOpacity={0.35} />
                  <stop offset="1" stopColor="#3987e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <Tooltip contentStyle={TOOLTIP} cursor={{ stroke: "rgb(255 255 255 / 25%)" }} />
              <Line
                type="monotone"
                dataKey="Paginaweergaven"
                stroke="#d55181"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="Bezoekers"
                stroke="#3987e5"
                strokeWidth={2}
                fill="url(#sa-v)"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <TopList
          title="Populairste pagina's"
          icon={MousePointerClick}
          rows={pages}
          render={(x) => <span className="font-mono text-[13px]">{x}</span>}
        />
        <TopList title="Waar ze vandaan komen" icon={Globe2} rows={sources} />
        <TopList
          title="Landen"
          icon={Users}
          rows={countries}
          render={(cc) => `${flag(cc)}  ${countryName(cc)}`}
        />
        <TopList
          title="Toestellen"
          icon={Monitor}
          rows={devices}
          render={(d) => (
            <span className="inline-flex items-center gap-1.5 capitalize">
              {d === "mobile" ? (
                <Smartphone className="size-3.5" />
              ) : (
                <Monitor className="size-3.5" />
              )}
              {d === "mobile" ? "gsm" : d === "desktop" ? "computer" : d}
            </span>
          )}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Bron: Lovable-analytics (enkel bezoeken op de door Lovable gehoste site). Klikken op knoppen
        meet Lovable niet.
      </p>
    </section>
  );
}

/** Overzicht op Vandaag: alle sites gerangschikt op bezoekers, tik om in te zoomen. */
export function VisitorsOverview({ targets }: { targets: { id: string; name: string }[] }) {
  const q = useQuery({
    queryKey: ["site_analytics_overview"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_analytics_daily")
        .select("target_id, day, visitors, pageviews")
        .gte("day", isoDay(13))
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = q.data ?? [];
  if (q.isLoading || !rows.length) return null;
  const from = isoDay(6);
  const stats = targets
    .map((t) => {
      const mine = rows.filter((r) => r.target_id === t.id);
      const cur = mine.filter((r) => r.day >= from);
      const prev = mine.filter((r) => r.day < from);
      const v = cur.reduce((s, r) => s + r.visitors, 0);
      const pv = prev.reduce((s, r) => s + r.visitors, 0);
      const spark = [...cur].sort((a, b) => a.day.localeCompare(b.day)).map((r) => r.visitors);
      return { ...t, v, pv, spark, has: mine.length > 0 };
    })
    .filter((s) => s.has)
    .sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...stats.map((s) => s.v));
  const total = stats.reduce((s, x) => s + x.v, 0);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Bezoekers · 7 dagen
        </h2>
        <span className="tabular text-xs text-muted-foreground">{total} in totaal</span>
      </div>
      <div className="panel divide-y divide-white/[0.06] overflow-hidden">
        {stats.slice(0, 8).map((s) => (
          <Link
            key={s.id}
            to="/target/$id"
            params={{ id: s.id }}
            hash="bezoekers"
            className="group relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04]"
          >
            <span
              className="absolute inset-y-1 left-1 rounded-lg bg-[#3987e5]/12"
              style={{ width: `${(s.v / max) * 60}%` }}
              aria-hidden
            />
            <span className="relative min-w-0 flex-1 truncate font-semibold">{s.name}</span>
            <svg viewBox="0 0 70 20" className="relative h-5 w-[70px] shrink-0" aria-hidden>
              <polyline
                fill="none"
                stroke="#3987e5"
                strokeWidth="1.8"
                strokeLinejoin="round"
                points={s.spark
                  .map(
                    (y, i, a) =>
                      `${(i / Math.max(1, a.length - 1)) * 70},${18 - (y / Math.max(1, ...a)) * 16}`,
                  )
                  .join(" ")}
              />
            </svg>
            <span className="tabular relative w-10 shrink-0 text-right font-bold">{s.v}</span>
            <span className="relative w-12 shrink-0 text-right">
              <Delta now={s.v} prev={s.pv} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
