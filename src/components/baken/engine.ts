/**
 * Baken — het brein.
 * Laag 1 (altijd, 0 credits): herkent de vraag, haalt de cijfers zelf op en kiest de beelden.
 * Laag 2 (optioneel): vrije vragen gaan naar /api/baken (taalmodel), met dezelfde cijfers als context.
 */
import { supabase } from "@/integrations/supabase/client";

export type Scene =
  | { kind: "vandaag"; data: TodayData }
  | { kind: "site"; data: SiteData }
  | { kind: "voorstellen"; data: ProposalLite[] }
  | { kind: "credits"; data: CreditLite[] }
  | { kind: "agenda"; data: AgendaLite[] }
  | { kind: "bezoekers"; data: VisitorLite[] }
  | { kind: "vondsten"; data: FindingLite[] };

export type BakenReply = { say: string; scenes: Scene[]; source: "lokaal" | "model" };

export type TargetLite = {
  id: string;
  name: string;
  kind: string;
  level: "rustig" | "aandacht" | "actie" | "onbekend";
  shot: string | null;
};
export type TodayData = {
  level: "rustig" | "aandacht" | "actie";
  targets: TargetLite[];
  issues: { target: string; title: string; severity: string }[];
  waiting: number;
  nextDeadline: AgendaLite | null;
};
export type SiteData = {
  id: string;
  name: string;
  url: string;
  shot: string | null;
  level: TargetLite["level"];
  latency: { t: string; ms: number; fails: number }[];
  visitors: { day: string; v: number; pv: number }[];
  issues: { title: string; severity: string }[];
};
export type ProposalLite = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  bundle_title: string | null;
};
export type CreditLite = { name: string; s: number; driver: string | null };
export type AgendaLite = {
  id: string;
  title: string;
  due_date: string;
  severity: string;
  days: number;
};
export type VisitorLite = { id: string; name: string; v: number; prev: number };
export type FindingLite = {
  title: string;
  severity: string;
  integration_key: string | null;
  effective_date: string | null;
};

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
const daysUntil = (d: string) => Math.round((Date.parse(d) - Date.parse(today())) / 86400000);
const isoDay = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ");
const plural = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
export function relDays(n: number) {
  if (n < 0) return `${-n} dagen te laat`;
  if (n === 0) return "vandaag";
  if (n === 1) return "morgen";
  return `over ${n} dagen`;
}

// ---------- data ----------

async function loadTargetsWithLevels(): Promise<{
  targets: TargetLite[];
  issues: TodayData["issues"];
}> {
  const [{ data: targets }, { data: incidents }] = await Promise.all([
    supabase
      .from("watch_targets")
      .select("id, name, kind, status, screenshot_url")
      .eq("enabled", true)
      .order("name"),
    supabase
      .from("incidents")
      .select("target_id, title, severity, acknowledged_until, watch_targets(name)")
      .is("resolved_at", null),
  ]);
  const active = (incidents ?? []).filter(
    (i) =>
      i.severity !== "monitor" &&
      !(i.acknowledged_until && Date.parse(i.acknowledged_until) > Date.now()),
  );
  const levelOf = (id: string, status: string): TargetLite["level"] => {
    const mine = active.filter((i) => i.target_id === id);
    if (mine.some((i) => i.severity === "actie")) return "actie";
    if (mine.some((i) => i.severity === "aandacht")) return "aandacht";
    return status === "unknown" ? "onbekend" : "rustig";
  };
  return {
    targets: (targets ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      level: levelOf(t.id, t.status),
      shot: t.screenshot_url,
    })),
    issues: active.map((i) => ({
      target: (i.watch_targets as { name?: string } | null)?.name ?? "",
      title: i.title,
      severity: i.severity,
    })),
  };
}

async function loadAgenda(): Promise<AgendaLite[]> {
  const { data } = await supabase
    .from("agenda")
    .select("id, title, due_date, severity")
    .eq("status", "open")
    .order("due_date");
  return (data ?? [])
    .map((a) => ({ ...a, days: daysUntil(a.due_date) }))
    .filter((a) => a.days <= 120);
}

async function loadToday(): Promise<TodayData> {
  const [{ targets, issues }, { count }, agenda] = await Promise.all([
    loadTargetsWithLevels(),
    supabase
      .from("proposals")
      .select("id", { count: "exact", head: true })
      .eq("status", "proposed"),
    loadAgenda(),
  ]);
  const level = issues.some((i) => i.severity === "actie")
    ? "actie"
    : issues.length
      ? "aandacht"
      : "rustig";
  return {
    level,
    targets,
    issues,
    waiting: count ?? 0,
    nextDeadline: agenda.find((a) => a.days >= 0) ?? null,
  };
}

async function loadSite(t: TargetLite): Promise<SiteData> {
  const [{ data: target }, lat, { data: vis }, { data: inc }] = await Promise.all([
    supabase.from("watch_targets").select("url").eq("id", t.id).single(),
    supabase.rpc("wt_latency_hourly", { p_days: 7 }),
    supabase
      .from("site_analytics_daily")
      .select("day, visitors, pageviews")
      .eq("target_id", t.id)
      .gte("day", isoDay(13))
      .order("day"),
    supabase
      .from("incidents")
      .select("title, severity")
      .eq("target_id", t.id)
      .is("resolved_at", null),
  ]);
  return {
    id: t.id,
    name: t.name,
    url: target?.url ?? "",
    shot: t.shot,
    level: t.level,
    latency: (lat.data ?? [])
      .filter((r) => r.target_id === t.id)
      .map((r) => ({ t: r.hour, ms: r.p50_ms, fails: r.fails })),
    visitors: (vis ?? []).map((r) => ({ day: r.day, v: r.visitors, pv: r.pageviews })),
    issues: (inc ?? []).filter((i) => i.severity !== "monitor"),
  };
}

async function loadProposals(): Promise<ProposalLite[]> {
  const { data } = await supabase
    .from("proposals")
    .select("id, title, description, status, bundle_title")
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(8);
  return data ?? [];
}

async function loadCredits(): Promise<CreditLite[]> {
  const { data } = await supabase
    .from("credit_latest")
    .select("project_name, exec_s_per_day, drivers");
  return (data ?? [])
    .filter((r) => (r.exec_s_per_day ?? 0) > 2)
    .map((r) => ({
      name: r.project_name,
      s: Math.round(Number(r.exec_s_per_day)),
      driver: r.drivers?.[0] ?? null,
    }))
    .sort((a, b) => b.s - a.s);
}

async function loadVisitors(): Promise<VisitorLite[]> {
  const [{ data: rows }, { data: targets }] = await Promise.all([
    supabase
      .from("site_analytics_daily")
      .select("target_id, day, visitors")
      .gte("day", isoDay(13))
      .limit(2000),
    supabase.from("watch_targets").select("id, name"),
  ]);
  const from = isoDay(6);
  return (targets ?? [])
    .map((t) => {
      const mine = (rows ?? []).filter((r) => r.target_id === t.id);
      return {
        id: t.id,
        name: t.name,
        v: mine.filter((r) => r.day >= from).reduce((s, r) => s + r.visitors, 0),
        prev: mine.filter((r) => r.day < from).reduce((s, r) => s + r.visitors, 0),
      };
    })
    .filter((x) => x.v + x.prev > 0)
    .sort((a, b) => b.v - a.v);
}

async function loadFindings(): Promise<FindingLite[]> {
  const { data } = await supabase
    .from("findings")
    .select("title, severity, integration_key, effective_date, impact, status")
    .in("status", ["nieuw", "pakket"])
    .neq("impact", "raakt_ons_niet")
    .in("severity", ["actie", "aandacht"])
    .order("severity");
  return (data ?? []).map(({ title, severity, integration_key, effective_date }) => ({
    title,
    severity,
    integration_key,
    effective_date,
  }));
}

// ---------- intenties ----------

type Intent =
  "vandaag" | "site" | "voorstellen" | "credits" | "agenda" | "bezoekers" | "vondsten" | "hulp";

const KEYWORDS: Array<[Intent, RegExp]> = [
  ["voorstellen", /\b(voorstel|voorstellen|go|goedkeur|pakket|wacht op mij|wachten)\b/],
  ["credits", /\b(credit|credits|kost|kosten|verbruik|duur|besparen|goedkoper|rekentijd)\b/],
  ["agenda", /\b(agenda|deadline|deadlines|verloopt|komt eraan|wanneer|datum|vervalt)\b/],
  ["bezoekers", /\b(bezoek|bezoekers|bezoeken|traffic|verkeer|views|pageviews|populair|drukte)\b/],
  [
    "vondsten",
    /\b(partner|partners|koppeling|koppelingen|radar|vondst|vondsten|risico|deprecat|api)\b/,
  ],
  ["hulp", /\b(help|wat kan je|wie ben je|hoe werk)\b/],
  [
    "vandaag",
    /\b(vandaag|status|hoe staat|overzicht|wat moet ik|alles goed|briefing|samenvatting)\b/,
  ],
];

export function detect(
  q: string,
  targets: TargetLite[],
): { intent: Intent | null; site: TargetLite | null } {
  const n = norm(q);
  const site =
    targets.find((t) => n.includes(norm(t.name))) ??
    targets.find((t) =>
      norm(t.name)
        .split(" ")
        .some((w) => w.length > 3 && n.split(" ").includes(w)),
    ) ??
    null;
  const hit = KEYWORDS.find(([, re]) => re.test(n));
  if (site && (!hit || hit[0] === "bezoekers" || hit[0] === "vandaag"))
    return { intent: "site", site };
  return { intent: hit?.[0] ?? null, site };
}

// ---------- antwoorden ----------

export async function answerLocally(q: string): Promise<BakenReply | null> {
  const { targets } = await loadTargetsWithLevels();
  const { intent, site } = detect(q, targets);
  if (!intent) return null;

  switch (intent) {
    case "vandaag":
      return sayToday(await loadToday());
    case "site": {
      const d = await loadSite(site!);
      const v7 = d.visitors.slice(-7).reduce((s, r) => s + r.v, 0);
      const med = [...d.latency].map((r) => r.ms).sort((a, b) => a - b)[
        Math.floor(d.latency.length / 2)
      ];
      const parts = [
        d.issues.length
          ? `${d.name} vraagt aandacht: ${d.issues.map((i) => i.title.toLowerCase()).join(", ")}.`
          : `${d.name} draait rustig.`,
        med ? `Reactietijd zit rond ${med} milliseconden.` : "",
        d.visitors.length ? `${plural(v7, "bezoeker", "bezoekers")} de voorbije week.` : "",
      ];
      return {
        say: parts.filter(Boolean).join(" "),
        scenes: [{ kind: "site", data: d }],
        source: "lokaal",
      };
    }
    case "voorstellen": {
      const p = await loadProposals();
      return {
        say: p.length
          ? `Er ${p.length === 1 ? "wacht 1 voorstel" : `wachten ${p.length} voorstellen`} op jouw go. Bovenaan: ${p[0].title}. Tik er een aan voor alle uitleg.`
          : "Niets wacht op jouw go. Mooi zo.",
        scenes: [{ kind: "voorstellen", data: p }],
        source: "lokaal",
      };
    }
    case "credits": {
      const c = await loadCredits();
      const total = c.reduce((s, r) => s + r.s, 0) || 1;
      return {
        say: c.length
          ? `${c[0].name} slorpt ${Math.round((c[0].s / total) * 100)} procent van de rekentijd op. ${c[0].driver ? `Grootste oorzaak: ${c[0].driver.split(":")[0].toLowerCase()}.` : ""} De besparingen staan klaar onder Credits.`
          : "Nog geen creditmeting. Die komt bij de ochtendronde.",
        scenes: [{ kind: "credits", data: c }],
        source: "lokaal",
      };
    }
    case "agenda": {
      const a = await loadAgenda();
      const late = a.filter((x) => x.days < 0);
      const next = a.find((x) => x.days >= 0);
      return {
        say: [
          late.length ? `${plural(late.length, "deadline is", "deadlines zijn")} al voorbij.` : "",
          next
            ? `Eerstvolgende: ${next.title}, ${relDays(next.days)}.`
            : "Geen deadlines in zicht.",
        ]
          .filter(Boolean)
          .join(" "),
        scenes: [{ kind: "agenda", data: a }],
        source: "lokaal",
      };
    }
    case "bezoekers": {
      const v = await loadVisitors();
      const total = v.reduce((s, r) => s + r.v, 0);
      return {
        say: v.length
          ? `${plural(total, "bezoeker", "bezoekers")} over alle sites deze week. ${v[0].name} trekt de meeste: ${v[0].v}.`
          : "Nog geen bezoekersdata.",
        scenes: [{ kind: "bezoekers", data: v }],
        source: "lokaal",
      };
    }
    case "vondsten": {
      const f = await loadFindings();
      const urgent = f.filter((x) => x.severity === "actie");
      return {
        say: f.length
          ? `De radar volgt ${plural(f.length, "vondst", "vondsten")} bij partners, waarvan ${urgent.length} met actie. ${urgent[0] ? `Dringendst: ${urgent[0].title}.` : ""}`
          : "Geen open vondsten bij partners.",
        scenes: [{ kind: "vondsten", data: f }],
        source: "lokaal",
      };
    }
    case "hulp":
      return {
        say: "Ik ben Baken. Vraag me hoe het vandaag gaat, hoe een site het doet, wat er op jouw go wacht, wat er eraan komt, hoeveel bezoekers er waren of waar de credits naartoe gaan. Ik toon het je meteen.",
        scenes: [],
        source: "lokaal",
      };
  }
}

export function sayToday(d: TodayData): BakenReply {
  const calm = d.targets.filter((t) => t.level === "rustig").length;
  const head =
    d.level === "rustig"
      ? `Alles rustig. ${calm} van de ${d.targets.length} sites draaien zonder zorgen.`
      : `${plural(new Set(d.issues.map((i) => i.target)).size, "site vraagt", "sites vragen")} ${d.level === "actie" ? "actie" : "aandacht"}: ${[...new Set(d.issues.map((i) => i.target))].slice(0, 3).join(", ")}.`;
  const tail = [
    d.waiting ? `${plural(d.waiting, "voorstel wacht", "voorstellen wachten")} op jouw go.` : "",
    d.nextDeadline
      ? `Volgende deadline: ${d.nextDeadline.title}, ${relDays(d.nextDeadline.days)}.`
      : "",
  ];
  return {
    say: [head, ...tail].filter(Boolean).join(" "),
    scenes: [{ kind: "vandaag", data: d }],
    source: "lokaal",
  };
}

// ---------- taalmodel: maakt van de cijfers een natuurlijk antwoord ----------

let caps: Promise<{ model: string | null; voice: string | null }> | null = null;
export function capabilities() {
  caps ??= fetch("/api/baken")
    .then((r) => (r.ok ? r.json() : { model: null, voice: null }))
    .catch(() => ({ model: null, voice: null }));
  return caps;
}

export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

function facts(scenes: Scene[]) {
  return scenes.map((s) => {
    switch (s.kind) {
      case "vandaag":
        return {
          beeld: "sterrenstelsel van alle sites",
          toestand: s.data.level,
          sites: s.data.targets.length,
          rustig: s.data.targets.filter((t) => t.level === "rustig").length,
          problemen: s.data.issues.slice(0, 6),
          wachtOpGo: s.data.waiting,
          volgendeDeadline: s.data.nextDeadline && {
            titel: s.data.nextDeadline.title,
            over: relDays(s.data.nextDeadline.days),
          },
        };
      case "site": {
        const ms = s.data.latency.map((r) => r.ms).sort((a, b) => a - b);
        return {
          beeld: `kaart van ${s.data.name} met schermafbeelding, reactietijd en bezoekers`,
          site: s.data.name,
          toestand: s.data.level,
          problemen: s.data.issues.map((i) => i.title),
          reactietijdMediaanMs: ms[Math.floor(ms.length / 2)] ?? null,
          mislukteMetingen7d: s.data.latency.reduce((a, r) => a + r.fails, 0),
          bezoekers7d: s.data.visitors.slice(-7).reduce((a, r) => a + r.v, 0),
          bezoekersVorigeWeek: s.data.visitors.slice(0, -7).reduce((a, r) => a + r.v, 0),
        };
      }
      case "voorstellen":
        return {
          beeld: "lijst voorstellen die op go wachten",
          voorstellen: s.data.map((p) => p.title),
        };
      case "credits":
        return {
          beeld: "balken rekentijd per project (seconden per dag)",
          projecten: s.data.slice(0, 6),
        };
      case "agenda":
        return {
          beeld: "tijdlijn met deadlines",
          deadlines: s.data
            .slice(0, 6)
            .map((a) => ({ titel: a.title, wanneer: relDays(a.days), ernst: a.severity })),
        };
      case "bezoekers":
        return { beeld: "ranking bezoekers per site deze week", sites: s.data.slice(0, 6) };
      case "vondsten":
        return { beeld: "vondsten bij partners", vondsten: s.data.slice(0, 6) };
    }
  });
}

async function phrase(
  q: string,
  history: { role: "user" | "assistant"; content: string }[],
  local: BakenReply | null,
): Promise<{ say: string; show: string[] } | null> {
  try {
    const context: Record<string, unknown> = { beeldEnFeiten: local ? facts(local.scenes) : [] };
    if (!local?.scenes.length) {
      const [t, c, a, p] = await Promise.all([
        loadToday(),
        loadCredits(),
        loadAgenda(),
        loadProposals(),
      ]);
      context.achtergrond = facts([
        { kind: "vandaag", data: t },
        { kind: "credits", data: c },
        { kind: "agenda", data: a },
        { kind: "voorstellen", data: p },
      ]);
    }
    const res = await fetch("/api/baken", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ question: q, history: history.slice(-6), context }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { say?: string; show?: string[] };
    return j.say ? { say: j.say, show: j.show ?? [] } : null;
  } catch {
    return null;
  }
}

async function sceneFor(kind: string): Promise<Scene | null> {
  if (kind === "vandaag") return { kind, data: await loadToday() };
  if (kind === "credits") return { kind, data: await loadCredits() };
  if (kind === "agenda") return { kind, data: await loadAgenda() };
  if (kind === "voorstellen") return { kind, data: await loadProposals() };
  if (kind === "bezoekers") return { kind, data: await loadVisitors() };
  if (kind === "vondsten") return { kind, data: await loadFindings() };
  return null;
}

/** Elke vraag: de cijfers en beelden komen lokaal, de woorden van het taalmodel (als dat er is). */
export async function ask(
  q: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<BakenReply> {
  const local = await answerLocally(q).catch(() => null);
  const { model } = await capabilities();
  if (model) {
    const m = await phrase(q, history, local);
    if (m) {
      let scenes = local?.scenes ?? [];
      if (!scenes.length)
        scenes = (await Promise.all(m.show.slice(0, 2).map(sceneFor))).filter(Boolean) as Scene[];
      return { say: m.say, scenes, source: "model" };
    }
  }
  return (
    local ?? {
      say: "Dat weet ik nog niet. Vraag me naar vandaag, een site, voorstellen, de agenda, bezoekers, partners of credits.",
      scenes: [],
      source: "lokaal",
    }
  );
}

export async function greet(): Promise<BakenReply> {
  return ask("Geef me in het kort de stand van vandaag.", []);
}
