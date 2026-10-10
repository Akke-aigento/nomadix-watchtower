/**
 * Watchtower scan-orkestratie (server-only).
 *
 * Per run (cron elke 10 min):
 *  1. per target per check: is die check aan de beurt? (policy.isCheckDue)
 *  2. meten (checks.server) en resultaten opslaan
 *  3. per gemeten check het incident openen / bijwerken / sluiten (policy.decide)
 *  4. target-status herberekenen uit de laatste meting per check
 *
 * Mails gaan enkel uit bij een nieuw (of naar actie geëscaleerd) incident met
 * ernst "actie" en bij herstel daarvan — niet meer bij elke statusovergang.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  checkDns,
  checkDomain,
  checkFormSmoke,
  hostOf,
  supportsDomainCheck,
  checkHealth,
  checkHttp,
  checkSsl,
  checkStore,
  checkOdoo,
  type CheckOutcome,
  type CheckStatus,
} from "@/lib/checks.server";
import { checkName, decide, describe, isCheckDue, targetStatus, type Severity } from "@/lib/policy";
import { anyDelivered, pushToAll } from "@/lib/notify.server";
import { closeProposalsFor, ensureProposal } from "@/lib/proposals.server";
import { degradedPartners, refreshPartnerStatus, upstreamLine } from "@/lib/partners.server";

export type { CheckOutcome, CheckStatus } from "@/lib/checks.server";

const DASHBOARD_URL = "https://nomadix-watchtower.lovable.app";

export async function sendAlertMail(subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: "Nomadix Watchtower <watchtower@sellqo.app>",
        to: ["info@sellqo.app"],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error(`Resend failed [${res.status}]: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Resend error", e);
    return false;
  }
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type Target = {
  id: string;
  name: string;
  url: string;
  kind: string;
  frequency: string;
  checks: Json;
  form_smoke_url: string | null;
  health_url: string | null;
  health_token: string | null;
  lovable_project_id: string | null;
  sellqo_tenant_id: string | null;
  status: string;
};

type Incident = {
  id: string;
  target_id: string;
  check_key: string;
  severity: string;
  status: string;
  title: string;
  acknowledged_until: string | null;
  notified_at: string | null;
};

type RecentRow = { check_key: string; status: CheckStatus; measured_at: string; detail: Json };

export function enabledChecks(t: Target): string[] {
  const c = (t.checks ?? {}) as Record<string, boolean>;
  const list: string[] = [];
  if (c.http !== false) list.push("http");
  if (c.ssl) list.push("ssl");
  if (c.dns) list.push("dns");
  if (c.form_smoke && t.form_smoke_url) list.push("form_smoke");
  if (c.health && t.health_url) list.push("health");
  if (c.domain !== false && supportsDomainCheck(hostOf(t.url))) list.push("domain");
  if (c.store !== false && t.sellqo_tenant_id) list.push("store");
  if (c.odoo) list.push("odoo");
  return list;
}

function runCheck(t: Target, key: string): Promise<CheckOutcome> {
  switch (key) {
    case "http":
      return checkHttp(t.url);
    case "ssl":
      return checkSsl(t.url);
    case "dns":
      return checkDns(t.url);
    case "form_smoke":
      return checkFormSmoke(t.form_smoke_url!);
    case "health":
      return checkHealth(t.health_url!, t.health_token);
    case "domain":
      return checkDomain(t.url);
    case "store":
      return checkStore(t.sellqo_tenant_id!);
    case "odoo":
      return checkOdoo(t.url);
    default:
      throw new Error(`onbekende check ${key}`);
  }
}

function isAcknowledged(inc: Pick<Incident, "acknowledged_until"> | undefined, now = Date.now()): boolean {
  return !!inc?.acknowledged_until && Date.parse(inc.acknowledged_until) > now;
}

async function addEvent(incidentId: string, kind: string, message: string) {
  await supabaseAdmin.from("incident_events").insert({ incident_id: incidentId, kind, message });
}

function incidentMail(target: Target, title: string, summary: string, recovered: boolean) {
  const color = recovered ? "#1F7A63" : "#C8402B";
  const label = recovered ? "Opgelost" : "Actie nodig";
  const subject = recovered ? `Opgelost · ${target.name} — ${title}` : `ACTIE · ${target.name} — ${title}`;
  const html = `<div style="background:#ECE9E3;padding:24px;font-family:Arial,sans-serif;color:#17191A">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
    <div style="background:${color};color:#fff;padding:12px 24px;font:600 12px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase">${label}</div>
    <div style="padding:22px 24px">
      <div style="font:600 13px/1.4 Arial,sans-serif;color:#5C6266">${esc(target.name)}</div>
      <div style="font:600 22px/1.25 Arial,sans-serif;margin:6px 0 10px">${esc(title)}</div>
      ${summary ? `<div style="font:400 15px/1.5 Arial,sans-serif;color:#3E4447">${esc(summary)}</div>` : ""}
      <div style="margin-top:20px"><a href="${DASHBOARD_URL}/target/${target.id}" style="display:inline-block;background:#17191A;color:#F5F3EF;text-decoration:none;font:600 14px/1 Arial,sans-serif;padding:12px 18px;border-radius:10px">Open in Watchtower</a></div>
    </div>
  </div>
</div>`;
  return { subject, html };
}

/** Actie-melding: mail + push tegelijk. Geeft terug of minstens één kanaal aankwam. */
async function notifyIncident(
  target: Target,
  incidentId: string,
  kind: "open" | "resolved",
  title: string,
  summary: string,
): Promise<{ mailed: boolean; pushed: boolean }> {
  const upstream = kind === "open" ? upstreamLine(await degradedPartners().catch(() => [])) : "";
  if (upstream) summary = `${summary}${summary ? " " : ""}Let op, partnerstoring: ${upstream}.`;
  const m = incidentMail(target, title, kind === "resolved" ? "Terug in orde." : summary, kind === "resolved");
  const [mailed, pushResults] = await Promise.all([
    sendAlertMail(m.subject, m.html),
    pushToAll(
      {
        title: kind === "resolved" ? `Opgelost · ${target.name}` : `Actie · ${target.name}`,
        body: kind === "resolved" ? `${title} — terug in orde.` : summary ? `${title}. ${summary}` : title,
        url: `/target/${target.id}`,
        tag: incidentId,
        severity: kind === "resolved" ? "ok" : "actie",
      },
      kind === "resolved" ? "normal" : "high",
    ),
  ]);
  const pushed = anyDelivered(pushResults);
  await addEvent(
    incidentId,
    "notified",
    `${kind === "resolved" ? "hersteld gemeld" : "actie gemeld"}: mail ${mailed ? "ok" : "mislukt"}, push ${pushResults.length ? (pushed ? "ok" : "mislukt") : "geen toestel"}`,
  );
  return { mailed, pushed };
}

/** Herinneringen voor open, niet-erkende actie-incidenten: elke 30 min de eerste 2 uur, daarna elke 4 uur. */
async function sendReminders(targetsById: Map<string, Target>) {
  const { data: open } = await supabaseAdmin
    .from("incidents")
    .select("id, target_id, title, summary, opened_at, notified_at, last_reminder_at, acknowledged_until")
    .eq("status", "open")
    .eq("severity", "actie")
    .not("notified_at", "is", null);
  const now = Date.now();
  let sent = 0;
  for (const inc of open ?? []) {
    if (isAcknowledged(inc, now)) continue;
    const target = targetsById.get(inc.target_id);
    if (!target) continue;
    const last = Date.parse(inc.last_reminder_at ?? inc.notified_at!);
    const ageMs = now - Date.parse(inc.opened_at);
    const interval = ageMs < 2 * 3600_000 ? 30 * 60_000 : 4 * 3600_000;
    if (now - last < interval - 60_000) continue;
    const hours = Math.max(1, Math.round(ageMs / 3600_000));
    const results = await pushToAll({
      title: `Nog open · ${target.name}`,
      body: `${inc.title} — al ${ageMs < 3600_000 ? `${Math.round(ageMs / 60_000)} min` : `${hours} u`}. Erken het om de herinneringen te stoppen.`,
      url: `/target/${target.id}`,
      tag: inc.id,
      severity: "actie",
    });
    await supabaseAdmin.from("incidents").update({ last_reminder_at: new Date().toISOString() }).eq("id", inc.id);
    await addEvent(inc.id, "reminder", `herinnering: push ${results.length ? (anyDelivered(results) ? "ok" : "mislukt") : "geen toestel"}`);
    sent++;
  }
  return sent;
}

async function logAlert(targetId: string, checkKey: string, transition: string, mailed: boolean, detail: Json) {
  await supabaseAdmin.from("alert_log").insert({ target_id: targetId, check_key: checkKey, transition, mailed, detail });
}

/** Incident-levenscyclus voor één target+check na een nieuwe meting. */
async function applyIncident(
  target: Target,
  outcome: CheckOutcome,
  history: CheckStatus[],
  open: Incident | undefined,
): Promise<Incident | undefined> {
  const decision = decide(outcome.check_key, history);
  const nowIso = new Date().toISOString();

  if (decision.kind === "none") {
    if (open?.severity === "monitor" && outcome.status !== "unknown") {
      // de monitor kan weer meten: monitor-incident sluiten
      await supabaseAdmin
        .from("incidents")
        .update({ status: "resolved", resolved_at: nowIso, last_seen_at: nowIso })
        .eq("id", open.id);
      await addEvent(open.id, "resolved", "meting lukt weer");
      return undefined;
    }
    if (open && outcome.status !== "unknown") {
      await supabaseAdmin.from("incidents").update({ last_seen_at: nowIso }).eq("id", open.id);
    }
    return open;
  }

  if (decision.kind === "resolve") {
    if (!open) return undefined;
    await supabaseAdmin
      .from("incidents")
      .update({ status: "resolved", resolved_at: nowIso, last_seen_at: nowIso })
      .eq("id", open.id);
    await addEvent(open.id, "resolved", `${checkName(outcome.check_key)} terug in orde`);
    await closeProposalsFor(open.id);
    let mailed = false;
    if (open.severity === "actie" && open.notified_at) {
      mailed = (await notifyIncident(target, open.id, "resolved", open.title, "")).mailed;
    }
    await logAlert(target.id, outcome.check_key, `resolved:${open.severity}`, mailed, outcome.detail);
    return undefined;
  }

  const severity: Severity = decision.kind === "monitor" ? "monitor" : decision.severity;
  const statusForText: CheckStatus = decision.kind === "monitor" ? "unknown" : decision.status;
  const { title, summary } = describe(outcome.check_key, statusForText, outcome.detail);

  if (open) {
    // Een echt probleem wint van een monitor-incident, niet omgekeerd.
    if (decision.kind === "monitor" && open.severity !== "monitor") return open;
    const changed = open.severity !== severity;
    await supabaseAdmin
      .from("incidents")
      .update({ severity, title, summary, detail: outcome.detail, last_seen_at: nowIso })
      .eq("id", open.id);
    if (changed) await addEvent(open.id, "severity", `${open.severity} → ${severity}: ${title}`);
    if (severity !== "monitor") await ensureProposal(target, outcome, open.id);
    let notified_at = open.notified_at;
    if (changed && severity === "actie" && !open.notified_at && !isAcknowledged(open)) {
      const { mailed, pushed } = await notifyIncident(target, open.id, "open", title, summary);
      if (mailed || pushed) {
        notified_at = nowIso;
        await supabaseAdmin.from("incidents").update({ notified_at }).eq("id", open.id);
      }
      await logAlert(target.id, outcome.check_key, `escalated:${severity}`, mailed, outcome.detail);
    }
    return { ...open, severity, title, notified_at };
  }

  const { data: created, error } = await supabaseAdmin
    .from("incidents")
    .insert({
      target_id: target.id,
      check_key: outcome.check_key,
      severity,
      title,
      summary,
      detail: outcome.detail,
    })
    .select("id, target_id, check_key, severity, status, title, acknowledged_until, notified_at")
    .single();
  if (error || !created) {
    // unieke index: een parallelle run heeft het al geopend
    console.error("incident insert", error?.message);
    return open;
  }
  await addEvent(created.id, "opened", title);
  if (severity !== "monitor") await ensureProposal(target, outcome, created.id);
  let mailed = false;
  if (severity === "actie") {
    const res = await notifyIncident(target, created.id, "open", title, summary);
    mailed = res.mailed;
    if (res.mailed || res.pushed) {
      await supabaseAdmin.from("incidents").update({ notified_at: nowIso }).eq("id", created.id);
    }
  }
  await logAlert(target.id, outcome.check_key, `opened:${severity}`, mailed, outcome.detail);
  return created as Incident;
}

export async function runScans() {
  const [{ data: targets, error }, { data: recent, error: recentErr }, { data: openIncidents }] = await Promise.all([
    supabaseAdmin.from("watch_targets").select("*").eq("enabled", true),
    supabaseAdmin.rpc("wt_recent_results", { n: 5 }),
    supabaseAdmin
      .from("incidents")
      .select("id, target_id, check_key, severity, status, title, acknowledged_until, notified_at")
      .eq("status", "open"),
  ]);
  if (error) throw error;
  if (recentErr) throw recentErr;

  const historyByKey = new Map<string, RecentRow[]>();
  for (const r of recent ?? []) {
    const key = `${r.target_id}|${r.check_key}`;
    const list = historyByKey.get(key) ?? [];
    list.push({ check_key: r.check_key, status: r.status as CheckStatus, measured_at: r.measured_at, detail: r.detail });
    historyByKey.set(key, list);
  }
  for (const list of historyByKey.values()) list.sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));

  const openByKey = new Map<string, Incident>();
  for (const inc of (openIncidents ?? []) as Incident[]) openByKey.set(`${inc.target_id}|${inc.check_key}`, inc);

  const scanned: Array<{ target: string; status: CheckStatus; checks: string[] }> = [];
  const now = Date.now();

  for (const target of (targets ?? []) as Target[]) {
    const keys = enabledChecks(target);
    const due = keys.filter((k) => isCheckDue(k, target, historyByKey.get(`${target.id}|${k}`)?.[0]?.measured_at, now));
    if (!due.length) continue;

    const outcomes = await Promise.all(due.map((k) => runCheck(target, k)));
    const measuredAt = new Date().toISOString();

    const { error: insErr } = await supabaseAdmin.from("scan_results").insert(
      outcomes.map((o) => ({
        target_id: target.id,
        check_key: o.check_key,
        status: o.status,
        latency_ms: o.latency_ms,
        detail: o.detail,
        measured_at: measuredAt,
      })),
    );
    if (insErr) {
      console.error("scan_results insert", insErr.message);
      continue;
    }

    for (const o of outcomes) {
      const key = `${target.id}|${o.check_key}`;
      const list = historyByKey.get(key) ?? [];
      list.unshift({ check_key: o.check_key, status: o.status, measured_at: measuredAt, detail: o.detail });
      historyByKey.set(key, list);
      const after = await applyIncident(target, o, list.map((r) => r.status), openByKey.get(key));
      if (after) openByKey.set(key, after);
      else openByKey.delete(key);
    }

    const latest = keys
      .map((k) => historyByKey.get(`${target.id}|${k}`)?.[0])
      .filter((r): r is RecentRow => !!r);
    const acked = new Set(keys.filter((k) => isAcknowledged(openByKey.get(`${target.id}|${k}`))));
    const overall = targetStatus(latest, acked);

    await supabaseAdmin
      .from("watch_targets")
      .update({ status: overall, last_scanned_at: measuredAt })
      .eq("id", target.id);

    scanned.push({ target: target.name, status: overall, checks: due });
  }

  const reminders = await sendReminders(new Map(((targets ?? []) as Target[]).map((t) => [t.id, t])));
  const partners = await refreshPartnerStatus().catch((e) => {
    console.error("partnerstatus", e);
    return { checked: 0, degraded: [] };
  });

  return {
    engine: "v2",
    scanned_count: scanned.length,
    reminders,
    partners_checked: partners.checked,
    partners_degraded: partners.degraded.map((d) => `${d.partner}: ${d.indicator}`),
    scanned,
  };
}

export async function dailyRollup() {
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const dayStr = yesterday.toISOString().slice(0, 10);
  const from = `${dayStr}T00:00:00.000Z`;
  const to = `${dayStr}T23:59:59.999Z`;

  const { data: rows, error } = await supabaseAdmin
    .from("scan_results")
    .select("target_id, check_key, status, latency_ms")
    .gte("measured_at", from)
    .lte("measured_at", to)
    .limit(20000);
  if (error) throw error;

  const byTarget = new Map<string, NonNullable<typeof rows>>();
  for (const row of rows ?? []) {
    const list = byTarget.get(row.target_id) ?? [];
    list.push(row);
    byTarget.set(row.target_id, list);
  }

  let written = 0;
  for (const [targetId, all] of byTarget) {
    const http = all.filter((r) => r.check_key === "http" && r.status !== "unknown");
    const uptime = http.length
      ? Math.round((http.filter((r) => r.status !== "fail").length / http.length) * 10000) / 100
      : null;
    const latencies = http.map((r) => r.latency_ms).filter((n): n is number => typeof n === "number");
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
    const failCount = all.filter((r) => r.status === "fail").length;

    await supabaseAdmin
      .from("daily_summaries")
      .upsert(
        { target_id: targetId, day: dayStr, uptime_pct: uptime, avg_latency_ms: avgLatency, fail_count: failCount },
        { onConflict: "target_id,day" },
      );
    written++;
  }

  // Ruwe metingen 30 dagen bewaren (bij 10-min-cadans); dagoverzichten blijven.
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  await supabaseAdmin.from("scan_results").delete().lt("measured_at", cutoff);

  return { day: dayStr, summaries_written: written };
}
