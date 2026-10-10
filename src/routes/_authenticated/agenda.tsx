import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  List,
  CalendarDays,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/detail-panel";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/agenda")({
  head: () => ({ meta: [{ title: "Agenda — Nomadix Watchtower" }] }),
  component: AgendaPage,
});

type Item = Tables<"agenda">;

const KIND_LABEL: Record<string, string> = {
  sunset: "Uitfasering",
  token: "Sleutel/token",
  certificate: "Certificaat",
  domain: "Domein",
  subscription: "Abonnement",
  migration: "Migratie",
  other: "Overig",
};

const SEV: Record<string, { color: string; label: string }> = {
  actie: { color: "#fb7185", label: "Actie" },
  aandacht: { color: "#fbbf24", label: "Aandacht" },
  info: { color: "#7dd3fc", label: "Info" },
};

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const monthFmt = new Intl.DateTimeFormat("nl-BE", { month: "long", year: "numeric" });
const longFmt = new Intl.DateTimeFormat("nl-BE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortFmt = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short" });

/** Vandaag in Brussel als YYYY-MM-DD. */
function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}
function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysUntil(k: string): number {
  return Math.round((parseKey(k).getTime() - parseKey(todayKey()).getTime()) / 86400000);
}
function relDays(n: number): string {
  if (n < 0) return `${-n} d te laat`;
  if (n === 0) return "vandaag";
  if (n === 1) return "morgen";
  if (n < 60) return `over ${n} d`;
  if (n < 730) return `over ${Math.round(n / 30)} mnd`;
  return `over ${Math.round(n / 365)} jaar`;
}

function AgendaPage() {
  const queryClient = useQueryClient();
  const today = todayKey();
  const [view, setView] = useState<"maand" | "lijst">("maand");
  const [cursor, setCursor] = useState(() => {
    const t = parseKey(today);
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string>(today);
  const [openItem, setOpenItem] = useState<Item | null>(null);

  const items = useQuery({
    queryKey: ["agenda"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda")
        .select("*")
        .eq("status", "open")
        .order("due_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const token = useQuery({
    queryKey: ["agenda_token"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_agenda_token");
      return typeof data === "string" ? data : null;
    },
  });

  const close = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "done" | "dismissed" }) => {
      const { error } = await supabase
        .from("agenda_items")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agenda"] });
      setOpenItem(null);
      toast.success("Afgevinkt");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = items.data ?? [];
  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const r of rows) m.set(r.due_date, [...(m.get(r.due_date) ?? []), r]);
    return m;
  }, [rows]);

  const feedUrl = token.data
    ? `${typeof window !== "undefined" ? window.location.origin : "https://nomadix-watchtower.lovable.app"}/api/public/agenda.ics?token=${token.data}`
    : null;
  const webcal = feedUrl?.replace(/^https?:/, "webcal:");

  // Raster: maandag als eerste dag, 6 weken.
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const cells = Array.from(
    { length: 42 },
    (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), 1 - offset + i),
  );
  const lastRowUsed = cells.slice(35).some((d) => d.getMonth() === cursor.getMonth());
  const grid = lastRowUsed ? cells : cells.slice(0, 35);

  const overdue = rows.filter((r) => daysUntil(r.due_date) < 0);
  const next30 = rows.filter((r) => {
    const n = daysUntil(r.due_date);
    return n >= 0 && n <= 30;
  });
  const nextUp = rows.find((r) => daysUntil(r.due_date) >= 0);
  const dayItems = byDay.get(selected) ?? [];

  const shift = (n: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const goToday = () => {
    const t = parseKey(today);
    setCursor(new Date(t.getFullYear(), t.getMonth(), 1));
    setSelected(today);
  };

  const ItemRow = ({ r }: { r: Item }) => {
    const n = daysUntil(r.due_date);
    const sev = SEV[r.severity] ?? SEV.info;
    return (
      <button
        type="button"
        onClick={() => setOpenItem(r)}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
      >
        <span className="flex w-12 shrink-0 flex-col items-center rounded-xl border border-white/10 bg-white/[0.04] py-1.5">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">
            {shortFmt.format(parseKey(r.due_date)).split(" ")[1]}
          </span>
          <span className="tabular text-lg font-bold leading-none">
            {parseKey(r.due_date).getDate()}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: sev.color, boxShadow: `0 0 10px ${sev.color}` }}
            />
            <span className="truncate font-semibold">{r.title}</span>
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {KIND_LABEL[r.kind] ?? r.kind}
            {r.integration_key ? ` · ${r.integration_key}` : ""}
          </span>
        </span>
        <span
          className={cn(
            "tabular shrink-0 text-xs font-semibold",
            n < 0 ? "text-[#fb7185]" : "text-muted-foreground",
          )}
        >
          {relDays(n)}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>
    );
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          eyebrow="Agenda"
          title={
            overdue.length
              ? `${overdue.length} ${overdue.length === 1 ? "deadline" : "deadlines"} voorbij`
              : nextUp
                ? `Volgende: ${relDays(daysUntil(nextUp.due_date))}`
                : "Geen deadlines"
          }
          subtitle={
            nextUp
              ? `${nextUp.title} · ${longFmt.format(parseKey(nextUp.due_date))}. ${next30.length} in de komende 30 dagen.`
              : "Alles wat ooit verloopt: API-versies, sleutels, certificaten, domeinen. Watchtower vult dit zelf aan."
          }
          actions={
            <div
              className="flex rounded-full border border-white/10 bg-white/[0.04] p-1"
              role="tablist"
              aria-label="Weergave"
            >
              {(
                [
                  ["maand", "Maand", CalendarDays],
                  ["lijst", "Lijst", List],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={view === k}
                  onClick={() => setView(k)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all",
                    view === k ? "text-[#06202c]" : "text-muted-foreground hover:text-foreground",
                  )}
                  style={
                    view === k
                      ? { background: "linear-gradient(135deg,#2dd4bf,#22d3ee 55%,#38bdf8)" }
                      : undefined
                  }
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          }
        />

        {view === "maand" ? (
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="panel rise min-w-0 overflow-hidden p-3 md:p-5">
              <div className="mb-3 flex items-center gap-2 px-1">
                <h2 className="flex-1 text-xl font-bold tracking-tight first-letter:uppercase">
                  {monthFmt.format(cursor)}
                </h2>
                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/[0.06]"
                >
                  Vandaag
                </button>
                <button
                  type="button"
                  aria-label="Vorige maand"
                  onClick={() => shift(-1)}
                  className="rounded-full p-2 hover:bg-white/[0.06]"
                >
                  <ChevronLeft className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label="Volgende maand"
                  onClick={() => shift(1)}
                  className="rounded-full p-2 hover:bg-white/[0.06]"
                >
                  <ChevronRight className="size-5" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {WEEKDAYS.map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {grid.map((d) => {
                  const k = keyOf(d);
                  const inMonth = d.getMonth() === cursor.getMonth();
                  const evs = byDay.get(k) ?? [];
                  const isToday = k === today;
                  const isSel = k === selected;
                  const worst =
                    evs.find((e) => e.severity === "actie") ??
                    evs.find((e) => e.severity === "aandacht") ??
                    evs[0];
                  const tint = worst ? (SEV[worst.severity] ?? SEV.info).color : null;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSelected(k)}
                      className={cn(
                        "relative flex aspect-square flex-col rounded-xl border p-1 text-left transition-all md:aspect-auto md:min-h-[96px] md:p-1.5",
                        inMonth
                          ? "border-white/[0.06] bg-white/[0.02]"
                          : "border-transparent opacity-35",
                        isSel && "border-transparent bg-white/[0.08] ring-2 ring-[#22d3ee]",
                        "hover:bg-white/[0.06]",
                      )}
                      style={
                        tint && inMonth
                          ? { background: `linear-gradient(160deg, ${tint}22, transparent 70%)` }
                          : undefined
                      }
                    >
                      <span
                        className={cn(
                          "tabular flex size-6 items-center justify-center rounded-full text-xs font-semibold md:size-7 md:text-sm",
                          isToday && "font-bold text-[#06202c]",
                        )}
                        style={
                          isToday
                            ? { background: "linear-gradient(135deg,#2dd4bf,#22d3ee 55%,#38bdf8)" }
                            : undefined
                        }
                      >
                        {d.getDate()}
                      </span>
                      {/* telefoon: stipjes */}
                      {evs.length > 0 && (
                        <span className="mt-auto flex flex-wrap justify-center gap-0.5 pb-0.5 md:hidden">
                          {evs.slice(0, 3).map((e) => (
                            <span
                              key={e.id}
                              className="size-1.5 rounded-full"
                              style={{ background: (SEV[e.severity] ?? SEV.info).color }}
                            />
                          ))}
                        </span>
                      )}
                      {/* desktop: titels */}
                      <span className="mt-1 hidden flex-col gap-0.5 md:flex">
                        {evs.slice(0, 2).map((e) => (
                          <span
                            key={e.id}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setOpenItem(e);
                            }}
                            className="truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-tight"
                            style={{
                              background: `${(SEV[e.severity] ?? SEV.info).color}26`,
                              color: (SEV[e.severity] ?? SEV.info).color,
                            }}
                          >
                            {e.title}
                          </span>
                        ))}
                        {evs.length > 2 && (
                          <span className="px-1.5 text-[11px] text-muted-foreground">
                            +{evs.length - 2}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 px-1 text-xs text-muted-foreground">
                {Object.values(SEV).map((s) => (
                  <span key={s.label} className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
            </section>

            <aside className="min-w-0 space-y-4">
              <section className="panel overflow-hidden">
                <div className="border-b border-white/[0.06] px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {selected === today ? "Vandaag" : "Geselecteerd"}
                  </div>
                  <div className="font-semibold first-letter:uppercase">
                    {longFmt.format(parseKey(selected))}
                  </div>
                </div>
                {dayItems.length ? (
                  <div className="divide-y divide-white/[0.06]">
                    {dayItems.map((r) => (
                      <ItemRow key={r.id} r={r} />
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-5 text-sm text-muted-foreground">Niets op deze dag.</p>
                )}
              </section>

              {(overdue.length > 0 || next30.length > 0) && (
                <section className="panel overflow-hidden">
                  <div className="border-b border-white/[0.06] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {overdue.length ? "Te laat en komende 30 dagen" : "Komende 30 dagen"}
                  </div>
                  <div className="divide-y divide-white/[0.06]">
                    {[...overdue, ...next30].map((r) => (
                      <ItemRow key={r.id} r={r} />
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </div>
        ) : (
          <div className="space-y-6">
            {(
              [
                ["Te laat", (n: number) => n < 0],
                ["Binnen 30 dagen", (n: number) => n >= 0 && n <= 30],
                ["Binnen 6 maanden", (n: number) => n > 30 && n <= 183],
                ["Later", (n: number) => n > 183],
              ] as const
            ).map(([label, f]) => {
              const list = rows.filter((r) => f(daysUntil(r.due_date)));
              if (!list.length) return null;
              return (
                <section key={label} className="space-y-2">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {label}
                  </h2>
                  <div className="panel divide-y divide-white/[0.06] overflow-hidden">
                    {list.map((r) => (
                      <ItemRow key={r.id} r={r} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {webcal && (
          <section className="panel glow-border flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <span className="brand-gradient flex size-11 shrink-0 items-center justify-center rounded-2xl">
              <CalendarPlus className="size-5 text-[#06202c]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">In je agenda op iPhone of Mac</div>
              <p className="text-sm text-muted-foreground">
                Eén tik: elke deadline in je agenda, met een herinnering 30 en 7 dagen vooraf.
              </p>
            </div>
            <div className="flex gap-2">
              <Button asChild size="sm">
                <a href={webcal}>Abonneren</a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(feedUrl!)
                    .then(() => toast.success("Link gekopieerd"))
                    .catch(() => toast.error("Kopiëren lukt niet"));
                }}
              >
                Kopieer link
              </Button>
            </div>
          </section>
        )}
      </div>

      <DetailPanel
        open={!!openItem}
        onClose={() => setOpenItem(null)}
        eyebrow={
          openItem
            ? `${KIND_LABEL[openItem.kind] ?? openItem.kind} · ${(SEV[openItem.severity] ?? SEV.info).label}`
            : "Agenda"
        }
        title={openItem?.title}
        footer={
          openItem?.origin === "agenda" ? (
            <Button
              size="lg"
              className="brand-gradient h-12 w-full rounded-2xl text-base font-bold text-[#06202c]"
              disabled={close.isPending}
              onClick={() => close.mutate({ id: openItem.id, status: "done" })}
            >
              Afvinken: gedaan
            </Button>
          ) : undefined
        }
      >
        {openItem && (
          <div key={openItem.id} className="rise space-y-6 pt-2">
            <div className="flex items-center gap-4">
              <span className="flex w-16 shrink-0 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.05] py-2">
                <span className="text-[11px] font-semibold uppercase text-muted-foreground">
                  {shortFmt.format(parseKey(openItem.due_date)).split(" ")[1]}
                </span>
                <span className="tabular text-2xl font-extrabold leading-none">
                  {parseKey(openItem.due_date).getDate()}
                </span>
              </span>
              <div className="min-w-0">
                <h2 className="text-2xl font-bold leading-tight tracking-tight">
                  {openItem.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground first-letter:uppercase">
                  {longFmt.format(parseKey(openItem.due_date))} ·{" "}
                  <span className={daysUntil(openItem.due_date) < 0 ? "text-[#fb7185]" : ""}>
                    {relDays(daysUntil(openItem.due_date))}
                  </span>
                </p>
              </div>
            </div>
            {openItem.description && (
              <p className="text-[15.5px] leading-relaxed text-foreground/90">
                {openItem.description}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {openItem.integration_key && (
                <Link
                  to="/koppelingen"
                  onClick={() => setOpenItem(null)}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-sm font-medium hover:bg-white/10"
                >
                  Koppeling: {openItem.integration_key}
                </Link>
              )}
              {openItem.target_id && (
                <Link
                  to="/target/$id"
                  params={{ id: openItem.target_id }}
                  onClick={() => setOpenItem(null)}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-sm font-medium hover:bg-white/10"
                >
                  Bekijk de site
                </Link>
              )}
              {openItem.source_url && (
                <a
                  href={openItem.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-sm font-medium hover:bg-white/10"
                >
                  Bron <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
            {openItem.origin !== "agenda" && (
              <p className="text-sm text-muted-foreground">
                Dit item komt uit de scans en verdwijnt vanzelf zodra het vernieuwd is.
              </p>
            )}
          </div>
        )}
      </DetailPanel>
    </AppShell>
  );
}
