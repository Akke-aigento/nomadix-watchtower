import { Link } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight, ChevronRight, ExternalLink } from "lucide-react";
import type { Scene, SiteData, TodayData } from "./engine";
import { relDays } from "./engine";
import { cn } from "@/lib/utils";

const LEVEL: Record<string, string> = {
  rustig: "#34d399",
  aandacht: "#fbbf24",
  actie: "#fb7185",
  onbekend: "#64748b",
};
const SEV: Record<string, string> = { actie: "#fb7185", aandacht: "#fbbf24", info: "#7dd3fc" };

function Card({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={cn(
        "rise rounded-[24px] border border-white/10 bg-white/[0.045] p-4 backdrop-blur-xl",
        className,
      )}
      style={{ animationDelay: `${delay}ms`, boxShadow: "inset 0 1px 0 0 rgb(255 255 255 / 7%)" }}
    >
      {children}
    </div>
  );
}

/** Sterrenstelsel: elke site een ster op een baan rond Baken, in de kleur van zijn toestand. */
function Constellation({ data, onClose }: { data: TodayData; onClose: () => void }) {
  const rings = [
    { kinds: ["platform", "storefront"], r: 30, dur: 90 },
    { kinds: ["venture"], r: 40, dur: 140 },
    { kinds: ["client_site"], r: 48, dur: 200 },
  ];
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]">
      {rings.map((ring, ri) => {
        const list = data.targets.filter((t) => ring.kinds.includes(t.kind));
        return (
          <div key={ri} className="absolute inset-0">
            <div
              className="absolute rounded-full border border-white/[0.07]"
              style={{ inset: `${50 - ring.r}%` }}
            />
            <div
              className="absolute inset-0"
              style={{ animation: `wt-sweep ${ring.dur}s linear infinite` }}
            >
              {list.map((t, i) => {
                const a = (i / Math.max(1, list.length)) * Math.PI * 2 + ri;
                const x = 50 + ring.r * Math.cos(a);
                const y = 50 + ring.r * Math.sin(a);
                const hot = t.level === "actie" || t.level === "aandacht";
                return (
                  <Link
                    key={t.id}
                    to="/target/$id"
                    params={{ id: t.id }}
                    onClick={onClose}
                    title={t.name}
                    className="group absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${x}%`, top: `${y}%` }}
                  >
                    <span
                      className="block rounded-full transition-transform group-hover:scale-150"
                      style={{
                        width: hot ? 14 : 9,
                        height: hot ? 14 : 9,
                        background: LEVEL[t.level],
                        boxShadow: `0 0 ${hot ? 18 : 10}px ${LEVEL[t.level]}`,
                        animation: hot ? "wt-breathe 1.6s ease-in-out infinite" : undefined,
                      }}
                    />
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
      <div
        className="absolute inset-[40%] rounded-full"
        style={{ background: "radial-gradient(circle, rgb(34 211 238 / 35%), transparent 70%)" }}
      />
    </div>
  );
}

function Spark({
  values,
  color,
  h = 56,
  fill = true,
}: {
  values: number[];
  color: string;
  h?: number;
  fill?: boolean;
}) {
  if (values.length < 2) return <div style={{ height: h }} />;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, h - 4 - (v / max) * (h - 10)]);
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <svg
      viewBox={`0 0 100 ${h}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height: h }}
      aria-hidden
    >
      {fill && <polygon points={`0,${h} ${line} 100,${h}`} fill={color} opacity=".15" />}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SiteScene({ d, onClose }: { d: SiteData; onClose: () => void }) {
  const v7 = d.visitors.slice(-7).reduce((s, r) => s + r.v, 0);
  const vPrev = d.visitors.slice(0, -7).reduce((s, r) => s + r.v, 0);
  const fails = d.latency.reduce((s, r) => s + r.fails, 0);
  const med =
    [...d.latency].map((r) => r.ms).sort((a, b) => a - b)[Math.floor(d.latency.length / 2)] ?? 0;
  return (
    <div className="space-y-3">
      {d.shot && (
        <div className="rise relative overflow-hidden rounded-[24px] border border-white/10">
          <img
            src={d.shot}
            alt={`Schermafbeelding van ${d.name}`}
            className="aspect-[16/10] w-full object-cover object-top"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050d19] via-[#050d19]/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-4">
            <span
              className="size-2.5 rounded-full"
              style={{ background: LEVEL[d.level], boxShadow: `0 0 12px ${LEVEL[d.level]}` }}
            />
            <span className="text-lg font-bold text-white">{d.name}</span>
          </div>
        </div>
      )}
      <Card>
        <div className="flex items-center gap-3">
          <span
            className="size-3 rounded-full"
            style={{ background: LEVEL[d.level], boxShadow: `0 0 14px ${LEVEL[d.level]}` }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-bold">{d.name}</div>
            <a
              href={d.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              {d.url.replace(/^https?:\/\//, "")} <ExternalLink className="size-3" />
            </a>
          </div>
          <Link
            to="/target/$id"
            params={{ id: d.id }}
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold"
          >
            Open
          </Link>
        </div>
        {d.issues.length > 0 && (
          <ul className="mt-3 space-y-1">
            {d.issues.map((i) => (
              <li key={i.title} className="flex items-center gap-2 text-sm">
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: SEV[i.severity] ?? SEV.info }}
                />
                {i.title}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Card delay={80}>
          <div className="text-xs font-semibold text-muted-foreground">Reactietijd · 7 d</div>
          <div className="tabular mt-1 text-2xl font-bold">{med ? `${med} ms` : "—"}</div>
          <div className="text-xs text-muted-foreground">
            {fails ? `${fails} mislukte metingen` : "geen storingen"}
          </div>
          <div className="mt-2">
            <Spark values={d.latency.map((r) => r.ms)} color="#22d3ee" h={44} />
          </div>
        </Card>
        <Card delay={160}>
          <div className="text-xs font-semibold text-muted-foreground">Bezoekers · 7 d</div>
          <div className="tabular mt-1 flex items-baseline gap-2 text-2xl font-bold">
            {d.visitors.length ? v7 : "—"}
            {vPrev > 0 && (
              <span
                className={cn(
                  "inline-flex items-center text-xs font-semibold",
                  v7 >= vPrev ? "text-[#34d399]" : "text-[#fb7185]",
                )}
              >
                {v7 >= vPrev ? (
                  <ArrowUpRight className="size-3.5" />
                ) : (
                  <ArrowDownRight className="size-3.5" />
                )}
                {Math.abs(Math.round(((v7 - vPrev) / vPrev) * 100))}%
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">vorige week {vPrev}</div>
          <div className="mt-2 flex h-11 items-end gap-1">
            {d.visitors.slice(-7).map((r) => (
              <span
                key={r.day}
                className="flex-1 rounded-t-[4px] bg-[#3987e5]"
                style={{
                  height: `${Math.max(6, (r.v / Math.max(1, ...d.visitors.slice(-7).map((x) => x.v))) * 100)}%`,
                }}
                title={`${r.day}: ${r.v}`}
              />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Galerij: echte schermafbeeldingen van de sites, wie aandacht vraagt eerst. */
function Gallery({ data, onClose }: { data: TodayData; onClose: () => void }) {
  const order = { actie: 0, aandacht: 1, onbekend: 2, rustig: 3 } as const;
  const list = data.targets.filter((t) => t.shot).sort((a, b) => order[a.level] - order[b.level]);
  if (!list.length) return null;
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
      {list.map((t, i) => (
        <Link
          key={t.id}
          to="/target/$id"
          params={{ id: t.id }}
          onClick={onClose}
          className="rise relative w-[62%] max-w-[260px] shrink-0 snap-start overflow-hidden rounded-[20px] border border-white/10"
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <img
            src={t.shot!}
            alt=""
            className="aspect-[16/10] w-full object-cover object-top"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050d19] via-transparent to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: LEVEL[t.level], boxShadow: `0 0 10px ${LEVEL[t.level]}` }}
            />
            <span className="truncate text-sm font-semibold text-white">{t.name}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function SceneView({
  scene,
  onClose,
  onOpenProposal,
}: {
  scene: Scene;
  onClose: () => void;
  onOpenProposal: (id: string) => void;
}) {
  switch (scene.kind) {
    case "vandaag": {
      const d = scene.data;
      return (
        <div className="space-y-3">
          <Constellation data={d} onClose={onClose} />
          <Gallery data={d} onClose={onClose} />
          {d.issues.length > 0 && (
            <Card>
              <ul className="space-y-2">
                {d.issues.slice(0, 5).map((i, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-sm">
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ background: SEV[i.severity] ?? SEV.info }}
                    />
                    <span>
                      <span className="font-semibold">{i.target}</span>{" "}
                      <span className="text-muted-foreground">· {i.title}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      );
    }
    case "site":
      return <SiteScene d={scene.data} onClose={onClose} />;
    case "voorstellen":
      return (
        <div className="space-y-2">
          {scene.data.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpenProposal(p.id)}
              className="rise flex w-full items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.045] p-4 text-left backdrop-blur-xl transition-transform active:scale-[0.98]"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full bg-[#22d3ee]/15 text-sm font-bold text-[#22d3ee]">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-snug">{p.title}</span>
                {p.bundle_title && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.bundle_title}
                  </span>
                )}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      );
    case "credits": {
      const max = Math.max(1, ...scene.data.map((c) => c.s));
      return (
        <Card>
          <div className="mb-3 text-xs font-semibold text-muted-foreground">Rekentijd per dag</div>
          <ul className="space-y-2.5">
            {scene.data.slice(0, 7).map((c, i) => (
              <li key={c.name}>
                <div className="flex justify-between text-sm">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="tabular font-bold">{c.s} s</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(c.s / max) * 100}%`,
                      background: "linear-gradient(90deg,#14b8a6,#06b6d4,#0ea5e9)",
                      animation: `wt-rise 0.8s cubic-bezier(0.2,0.8,0.2,1) ${i * 90}ms both`,
                      transformOrigin: "left",
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <Link
            to="/kosten"
            onClick={onClose}
            className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#22d3ee]"
          >
            Besparingen bekijken <ChevronRight className="size-4" />
          </Link>
        </Card>
      );
    }
    case "agenda": {
      const items = scene.data;
      const min = Math.min(0, ...items.map((a) => a.days));
      const max = Math.max(30, ...items.map((a) => a.days));
      const pos = (d: number) => ((d - min) / (max - min)) * 100;
      return (
        <Card>
          <div className="relative h-20">
            <div className="absolute top-10 right-0 left-0 h-px bg-white/15" />
            <div className="absolute top-6 h-8 w-px bg-[#22d3ee]" style={{ left: `${pos(0)}%` }}>
              <span className="absolute -top-5 -translate-x-1/2 text-[10px] font-bold text-[#22d3ee]">
                vandaag
              </span>
            </div>
            {items.map((a) => (
              <span
                key={a.id}
                className="absolute top-10 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${pos(a.days)}%`,
                  background: SEV[a.severity] ?? SEV.info,
                  boxShadow: `0 0 10px ${SEV[a.severity] ?? SEV.info}`,
                }}
                title={a.title}
              />
            ))}
          </div>
          <ul className="mt-2 space-y-2">
            {items.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-3 text-sm">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: SEV[a.severity] ?? SEV.info }}
                />
                <span className="min-w-0 flex-1 truncate">{a.title}</span>
                <span
                  className={cn(
                    "tabular shrink-0 text-xs font-semibold",
                    a.days < 0 ? "text-[#fb7185]" : "text-muted-foreground",
                  )}
                >
                  {relDays(a.days)}
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/agenda"
            onClick={onClose}
            className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#22d3ee]"
          >
            Agenda openen <ChevronRight className="size-4" />
          </Link>
        </Card>
      );
    }
    case "bezoekers": {
      const max = Math.max(1, ...scene.data.map((v) => v.v));
      return (
        <Card>
          <ul className="space-y-2">
            {scene.data.slice(0, 8).map((v, i) => (
              <li key={v.id}>
                <Link
                  to="/target/$id"
                  params={{ id: v.id }}
                  hash="bezoekers"
                  onClick={onClose}
                  className="block"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{v.name}</span>
                    <span className="tabular font-bold">{v.v}</span>
                    {v.prev > 0 && (
                      <span
                        className={cn(
                          "tabular w-11 text-right text-xs font-semibold",
                          v.v >= v.prev ? "text-[#34d399]" : "text-[#fb7185]",
                        )}
                      >
                        {v.v >= v.prev ? "+" : "−"}
                        {Math.abs(Math.round(((v.v - v.prev) / v.prev) * 100))}%
                      </span>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-[#3987e5]"
                      style={{
                        width: `${(v.v / max) * 100}%`,
                        animation: `wt-rise 0.7s ease ${i * 70}ms both`,
                      }}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      );
    }
    case "vondsten":
      return (
        <div className="space-y-2">
          {scene.data.slice(0, 6).map((f, i) => (
            <Card key={f.title} delay={i * 60} className="flex items-start gap-3 p-3.5">
              <span
                className="mt-1.5 size-2.5 shrink-0 rounded-full"
                style={{ background: SEV[f.severity], boxShadow: `0 0 10px ${SEV[f.severity]}` }}
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-snug">{f.title}</div>
                <div className="text-xs text-muted-foreground">
                  {f.integration_key}
                  {f.effective_date ? ` · ${f.effective_date}` : ""}
                </div>
              </div>
            </Card>
          ))}
        </div>
      );
  }
}
