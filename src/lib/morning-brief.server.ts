/**
 * Ochtendbrief (server-only). Eén vraag: moet ik vandaag iets doen?
 *
 * Onderwerp vertelt het al: "Rustig · …", "Aandacht · …" of "Actie · …".
 * Blokken (lege blokken verdwijnen): Actie, Aandacht, Sinds gisteren,
 * Komt eraan, Wacht op jouw go, Rustig, en een voetregel met Erkend + Zelfcontrole.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendAlertMail } from "@/lib/scan.server";

const DASHBOARD_URL = "https://nomadix-watchtower.lovable.app";
const C = {
  bg: "#ECE9E3",
  card: "#FFFFFF",
  text: "#17191A",
  body: "#2A2D2F",
  muted: "#5C6266",
  actie: "#C8402B",
  actieText: "#A8341F",
  aandacht: "#8A5A00",
  rustig: "#1F7A63",
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function brusselsDate(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return d.toLocaleDateString("nl-BE", { timeZone: "Europe/Brussels", ...opts });
}

function since(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const h = Math.round(ms / 3600000);
  if (h < 1) return "net";
  if (h < 48) return `${h} u`;
  return `${Math.round(h / 24)} dagen`;
}

function card(inner: string, extra = ""): string {
  return `<div style="background:${C.card};border-radius:14px;padding:22px 26px;margin:0 0 14px 0;${extra}">${inner}</div>`;
}

function label(text: string, color = C.muted): string {
  return `<div style="font:600 12px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${color};margin:0 0 12px 0">${esc(text)}</div>`;
}

function button(href: string, text: string, dark = true): string {
  return `<a href="${href}" style="display:inline-block;background:${dark ? C.text : "#E7E4DE"};color:${dark ? "#F5F3EF" : C.text};text-decoration:none;font:600 14px/1 Arial,sans-serif;padding:12px 18px;border-radius:10px;margin-right:8px">${esc(text)}</a>`;
}

type IncidentRow = {
  id: string;
  target_id: string;
  check_key: string;
  severity: string;
  status: string;
  title: string;
  summary: string | null;
  opened_at: string;
  resolved_at: string | null;
  acknowledged_until: string | null;
  acknowledged_note: string | null;
};

/** Weekblok: uptime, snelheid t.o.v. vorige week, incidenten, traagste property. */
async function weekBlock(
  targets: Array<{ id: string; name: string }>,
  nameOf: Map<string, string>,
): Promise<string | null> {
  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const [{ data: sums }, { data: inc }] = await Promise.all([
    supabaseAdmin
      .from("daily_summaries")
      .select("target_id, day, uptime_pct, avg_latency_ms")
      .gte("day", day(14)),
    supabaseAdmin
      .from("incidents")
      .select("id, target_id, severity, opened_at, resolved_at")
      .gte("opened_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .neq("severity", "monitor"),
  ]);
  const rows = sums ?? [];
  if (!rows.length) return null;
  const thisWeek = rows.filter((r) => r.day >= day(7));
  const lastWeek = rows.filter((r) => r.day < day(7));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const uptime = avg(thisWeek.map((r) => Number(r.uptime_pct)).filter((n) => Number.isFinite(n)));
  const latNow = avg(thisWeek.map((r) => r.avg_latency_ms).filter((n): n is number => typeof n === "number"));
  const latPrev = avg(lastWeek.map((r) => r.avg_latency_ms).filter((n): n is number => typeof n === "number"));

  const perTarget = targets
    .map((t) => ({
      name: t.name,
      lat: avg(thisWeek.filter((r) => r.target_id === t.id).map((r) => r.avg_latency_ms).filter((n): n is number => typeof n === "number")),
      up: avg(thisWeek.filter((r) => r.target_id === t.id).map((r) => Number(r.uptime_pct)).filter((n) => Number.isFinite(n))),
    }))
    .filter((x) => x.lat !== null);
  const slowest = [...perTarget].sort((a, b) => (b.lat ?? 0) - (a.lat ?? 0))[0];
  const worstUp = [...perTarget].filter((x) => x.up !== null && x.up < 100).sort((a, b) => (a.up ?? 100) - (b.up ?? 100))[0];

  const opened = (inc ?? []).length;
  const resolved = (inc ?? []).filter((i) => i.resolved_at).length;
  const actie = (inc ?? []).filter((i) => i.severity === "actie").length;

  const fmtS = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(2).replace(".", ",")} s`);
  const trend =
    latNow !== null && latPrev !== null && latPrev > 0
      ? (() => {
          const pct = Math.round(((latNow - latPrev) / latPrev) * 100);
          if (Math.abs(pct) < 5) return "even snel als vorige week";
          return pct > 0 ? `${pct}% trager dan vorige week` : `${-pct}% sneller dan vorige week`;
        })()
      : "nog geen vergelijking met vorige week";

  const stat = (big: string, small: string) =>
    `<td style="padding:0 16px 0 0;vertical-align:top"><div style="font:600 24px/1.2 Arial,sans-serif;color:${C.text}">${esc(big)}</div><div style="font:400 13px/1.4 Arial,sans-serif;color:${C.muted}">${esc(small)}</div></td>`;
  const lines = [
    `Gemiddelde laadtijd ${fmtS(latNow)} — ${trend}.`,
    slowest ? `Traagste: ${slowest.name} (${fmtS(slowest.lat)}).` : "",
    worstUp ? `Laagste beschikbaarheid: ${worstUp.name} (${worstUp.up!.toFixed(1).replace(".", ",")}%).` : "Elke property was de hele week bereikbaar.",
  ].filter(Boolean);
  void nameOf;

  return card(
    label("Je week") +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:14px"><tr>
        ${stat(uptime === null ? "—" : `${uptime.toFixed(2).replace(".", ",")}%`, "bereikbaar")}
        ${stat(String(opened), opened === 1 ? "incident" : "incidenten")}
        ${stat(String(resolved), "opgelost")}
        ${stat(String(actie), "keer actie")}
      </tr></table>` +
      lines.map((l) => `<div style="font:400 15px/1.5 Arial,sans-serif;color:${C.body}">${esc(l)}</div>`).join(""),
  );
}

export async function morningBrief(opts: { dryRun?: boolean; week?: boolean } = {}): Promise<{
  sent: boolean;
  subject: string;
  sections: string[];
  html?: string;
}> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600000).toISOString();

  const [{ data: targets }, { data: openInc }, { data: recentInc }, { data: proposals }, { data: ssl }, { count: unknownCount }] =
    await Promise.all([
      supabaseAdmin.from("watch_targets").select("id, name, kind, status").eq("enabled", true).order("name"),
      supabaseAdmin.from("incidents").select("*").eq("status", "open").order("opened_at"),
      supabaseAdmin
        .from("incidents")
        .select("*")
        .or(`opened_at.gte.${dayAgo},resolved_at.gte.${dayAgo}`)
        .neq("severity", "monitor"),
      supabaseAdmin.from("proposals").select("id, title, category, created_at").eq("status", "proposed"),
      supabaseAdmin.rpc("wt_recent_results", { n: 1 }),
      supabaseAdmin.from("scan_results").select("id", { count: "exact", head: true }).eq("status", "unknown").gte("measured_at", dayAgo),
    ]);

  const list = targets ?? [];
  const nameOf = new Map(list.map((t) => [t.id, t.name]));
  const isAcked = (i: IncidentRow) => !!i.acknowledged_until && Date.parse(i.acknowledged_until) > now.getTime();
  const open = (openInc ?? []) as IncidentRow[];
  const actie = open.filter((i) => i.severity === "actie" && !isAcked(i));
  const aandacht = open.filter((i) => i.severity === "aandacht" && !isAcked(i));
  const monitor = open.filter((i) => i.severity === "monitor");
  const acked = open.filter((i) => isAcked(i));
  const troubled = new Set([...actie, ...aandacht].map((i) => i.target_id));

  const blocks: string[] = [];
  const sections: string[] = [];
  const dateLong = brusselsDate(now, { weekday: "long", day: "numeric", month: "long" });
  const dateShort = brusselsDate(now, { weekday: "short", day: "numeric", month: "short" });

  // Kop
  const level = actie.length ? "actie" : aandacht.length ? "aandacht" : "rustig";
  const levelColor = level === "actie" ? C.actie : level === "aandacht" ? C.aandacht : C.rustig;
  const actieTargets = new Set(actie.map((i) => i.target_id)).size;
  const aandachtTargets = new Set(aandacht.map((i) => i.target_id)).size;
  const headline =
    level === "actie"
      ? `${actieTargets === 1 ? "1 property vraagt" : `${actieTargets} properties vragen`} actie.`
      : level === "aandacht"
        ? `${aandachtTargets === 1 ? "1 property vraagt" : `${aandachtTargets} properties vragen`} aandacht.`
        : "Alles rustig.";
  const sub = level === "rustig"
    ? `${list.length} properties, alle beloftes gehouden.`
    : `${list.length - troubled.size} van de ${list.length} properties zijn rustig.`;
  blocks.push(
    card(
      `<div style="font:600 12px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${levelColor};margin-bottom:12px">● ${level === "actie" ? "Actie" : level === "aandacht" ? "Aandacht" : "Rustig"}</div>
       <div style="font:600 30px/1.15 Arial,sans-serif;color:${C.text}">${esc(headline)}</div>
       <div style="font:400 16px/1.5 Arial,sans-serif;color:#3E4447;margin-top:8px">${esc(sub)}</div>`,
    ),
  );
  sections.push("kop");

  // Actie
  for (const i of actie) {
    blocks.push(
      card(
        `<div style="font:600 13px/1.4 Arial,sans-serif;color:${C.actieText};margin-bottom:6px">ACTIE · open sinds ${esc(since(i.opened_at))}</div>
         <div style="font:600 18px/1.3 Arial,sans-serif;color:${C.text}">${esc(nameOf.get(i.target_id) ?? "")} — ${esc(i.title)}</div>
         ${i.summary ? `<div style="font:400 15px/1.5 Arial,sans-serif;color:${C.body};margin-top:6px">${esc(i.summary)}</div>` : ""}
         <div style="margin-top:16px">${button(`${DASHBOARD_URL}/target/${i.target_id}`, "Bekijk")}</div>`,
        `border-top:4px solid ${C.actie};`,
      ),
    );
  }
  if (actie.length) sections.push("actie");

  // Aandacht
  if (aandacht.length) {
    const byTarget = new Map<string, IncidentRow[]>();
    for (const i of aandacht) byTarget.set(i.target_id, [...(byTarget.get(i.target_id) ?? []), i]);
    const rows = [...byTarget.entries()]
      .map(
        ([targetId, items]) => `<div style="margin:0 0 16px 0">
          <div style="font:600 16px/1.4 Arial,sans-serif;color:${C.text};margin-bottom:4px"><a href="${DASHBOARD_URL}/target/${targetId}" style="color:${C.text};text-decoration:none">${esc(nameOf.get(targetId) ?? "")}</a></div>
          ${items
            .map(
              (i) => `<div style="font:400 15px/1.5 Arial,sans-serif;color:${C.body}"><strong style="font-weight:600">${esc(i.title)}</strong>${i.summary ? ` — <span style="color:${C.muted}">${esc(i.summary)}</span>` : ""}</div>`,
            )
            .join("")}
        </div>`,
      )
      .join("");
    blocks.push(card(label("Aandacht · kan wachten", C.aandacht) + rows));
    sections.push("aandacht");
  }

  // Sinds gisteren
  const recent = (recentInc ?? []) as IncidentRow[];
  const resolved = recent.filter((i) => i.status === "resolved" && i.resolved_at && i.resolved_at >= dayAgo);
  const opened = recent.filter((i) => i.opened_at >= dayAgo && !isAcked(i));
  if (resolved.length || opened.length) {
    const line = (tag: string, color: string, i: IncidentRow) =>
      `<div style="font:400 15px/1.5 Arial,sans-serif;color:${C.body};margin-bottom:6px"><span style="display:inline-block;width:78px;font-weight:600;color:${color}">${tag}</span>${esc(nameOf.get(i.target_id) ?? "")} · ${esc(i.title)}</div>`;
    blocks.push(
      card(
        label("Sinds gisteren") +
          resolved.map((i) => line("Opgelost", C.rustig, i)).join("") +
          opened.map((i) => line("Nieuw", i.severity === "actie" ? C.actieText : C.aandacht, i)).join(""),
      ),
    );
    sections.push("sinds_gisteren");
  }

  // Komt eraan: certificaten (≤30 d) en domeinnamen (≤60 d)
  const upcoming = (ssl ?? [])
    .filter((r) => r.check_key === "ssl" || r.check_key === "domain")
    .map((r) => ({ r, d: (r.detail ?? {}) as { days_left?: number; host?: string; domain?: string } }))
    .filter(
      (x) =>
        typeof x.d.days_left === "number" &&
        x.d.days_left >= 0 &&
        x.d.days_left <= (x.r.check_key === "domain" ? 60 : 30),
    )
    .sort((a, b) => (a.d.days_left ?? 0) - (b.d.days_left ?? 0));
  if (upcoming.length) {
    blocks.push(
      card(
        label("Komt eraan") +
          upcoming
            .map(
              (x) =>
                `<div style="font:400 15px/1.5 Arial,sans-serif;color:${C.body};margin-bottom:6px"><span style="display:inline-block;width:78px;font-family:ui-monospace,Menlo,Consolas,monospace;color:${C.muted}">${x.d.days_left} d</span>${x.r.check_key === "domain" ? "Domeinnaam" : "Certificaat"} ${esc(x.d.domain ?? x.d.host ?? nameOf.get(x.r.target_id) ?? "")}</div>`,
            )
            .join(""),
      ),
    );
    sections.push("komt_eraan");
  }

  // Wacht op jouw go
  if ((proposals ?? []).length) {
    blocks.push(
      card(
        label("Wacht op jouw go") +
          (proposals ?? [])
            .map((p) => `<div style="font:400 15px/1.5 Arial,sans-serif;color:${C.body};margin-bottom:6px">${esc(p.title)} <span style="color:${C.muted}">· ${esc(since(p.created_at))}</span></div>`)
            .join(""),
      ),
    );
    sections.push("voorstellen");
  }

  // Rustig
  const calm = list.filter((t) => !troubled.has(t.id)).map((t) => t.name);
  if (calm.length && level !== "rustig") {
    blocks.push(card(label("Rustig") + `<div style="font:400 15px/1.6 Arial,sans-serif;color:#3E4447">${esc(calm.join(", "))}</div>`));
    sections.push("rustig");
  }

  // Maandag (of ?week=1): de week in vogelvlucht
  const isMonday = brusselsDate(now, { weekday: "long" }) === "maandag";
  if (isMonday || opts.week) {
    const week = await weekBlock(list, nameOf);
    if (week) {
      blocks.push(week);
      sections.push("week");
    }
  }

  // Voet
  const foot: string[] = [];
  for (const i of acked) {
    foot.push(`Erkend: ${esc(nameOf.get(i.target_id) ?? "")} · ${esc(i.title)} tot ${esc(brusselsDate(new Date(i.acknowledged_until!), { day: "numeric", month: "short" }))}`);
  }
  if (monitor.length) {
    foot.push(`Zelfcontrole: ${monitor.length} meting(en) lukken al een tijd niet — ${esc(monitor.map((i) => nameOf.get(i.target_id)).join(", "))}`);
  } else {
    foot.push(`Zelfcontrole: metingen in orde${unknownCount ? ` (${unknownCount} losse meetfout(en), telt niet mee)` : ""}`);
  }

  const subjectLevel =
    level === "actie"
      ? `Actie · ${actie.length} open${aandacht.length ? `, ${aandacht.length} aandacht` : ""}`
      : level === "aandacht"
        ? `Aandacht · ${aandacht.length}`
        : "Rustig · Nomadix";
  const subject = `${subjectLevel} · ${dateShort}`;

  const html = `<div style="background:${C.bg};padding:28px 16px;font-family:Arial,sans-serif;color:${C.text}">
  <div style="max-width:600px;margin:0 auto">
    <div style="font:600 13px/1.4 Arial,sans-serif;color:${C.muted};margin:0 0 14px 4px">Nomadix Watchtower · ${esc(dateLong)}</div>
    ${blocks.join("")}
    <div style="text-align:center;margin:18px 0">${button(DASHBOARD_URL + "/dashboard", "Open dashboard")}</div>
    <div style="font:400 13px/1.6 Arial,sans-serif;color:${C.muted};text-align:center">${foot.join("<br>")}</div>
  </div>
</div>`;

  if (opts.dryRun) return { sent: false, subject, sections, html };
  const sent = await sendAlertMail(subject, html);
  return { sent, subject, sections };
}
