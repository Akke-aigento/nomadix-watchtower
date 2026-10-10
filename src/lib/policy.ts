/**
 * Watchtower beleid (puur, zonder I/O — testbaar).
 *
 * - Wanneer is een check aan de beurt (frequentie per check, niet per target)?
 * - Wanneer wordt een slechte meting een incident (bevestiging)?
 * - Welke ernst krijgt dat incident (actie / aandacht / monitor)?
 */
import type { CheckStatus } from "@/lib/checks.server";

export type Severity = "actie" | "aandacht" | "monitor";

export type TargetLike = { kind: string; frequency: string };

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Minimale tijd tussen twee metingen van dezelfde check. Cron draait elke 10 min. */
export function checkIntervalMs(checkKey: string, target: TargetLike): number {
  switch (checkKey) {
    case "health":
    case "store":
      return 8 * MIN;
    case "odoo":
      return 55 * MIN;
    case "http":
      return target.kind === "platform" || target.kind === "storefront" ? 8 * MIN : 55 * MIN;
    case "ssl":
    case "dns":
    case "domain":
    case "form_smoke":
      return target.frequency === "weekly" ? 6 * 24 * HOUR : 20 * HOUR;
    default:
      return 20 * HOUR;
  }
}

export function isCheckDue(
  checkKey: string,
  target: TargetLike,
  lastMeasuredAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastMeasuredAt) return true;
  return now - Date.parse(lastMeasuredAt) >= checkIntervalMs(checkKey, target);
}

/** Hoeveel opeenvolgende slechte metingen nodig zijn voor een incident. */
export function confirmationsNeeded(checkKey: string, status: "warn" | "fail"): number {
  if (checkKey === "http") return status === "fail" ? 2 : 3;
  if (checkKey === "health" || checkKey === "store" || checkKey === "odoo") return 2;
  return 1; // ssl/dns/form_smoke: dagelijkse checks, één meting volstaat
}

export function severityFor(checkKey: string, status: "warn" | "fail"): Severity {
  if (status === "fail") return "actie";
  return "aandacht";
}

export const UNKNOWN_STREAK_FOR_MONITOR = 3;

export type Decision =
  | { kind: "none" }
  | { kind: "open_or_update"; severity: Severity; status: CheckStatus }
  | { kind: "monitor" }
  | { kind: "resolve" };

/**
 * Beslis op basis van de historiek (nieuwste eerst) wat er met het incident
 * voor deze target+check moet gebeuren.
 */
export function decide(checkKey: string, history: CheckStatus[]): Decision {
  if (history.length === 0) return { kind: "none" };
  const latest = history[0];

  if (latest === "unknown") {
    let streak = 0;
    for (const s of history) {
      if (s !== "unknown") break;
      streak++;
    }
    return streak >= UNKNOWN_STREAK_FOR_MONITOR ? { kind: "monitor" } : { kind: "none" };
  }

  if (latest === "ok") return { kind: "resolve" };

  // warn/fail: tel opeenvolgende niet-ok metingen; unknown is neutraal.
  const known = history.filter((s) => s !== "unknown");
  let bad = 0;
  let fails = 0;
  for (const s of known) {
    if (s === "ok") break;
    bad++;
    if (s === "fail") fails++;
  }
  // fail pas als fail zelf bevestigd is; anders val terug op warn.
  if (latest === "fail" && fails >= confirmationsNeeded(checkKey, "fail")) {
    return { kind: "open_or_update", severity: severityFor(checkKey, "fail"), status: "fail" };
  }
  if (bad >= confirmationsNeeded(checkKey, "warn")) {
    return { kind: "open_or_update", severity: severityFor(checkKey, "warn"), status: "warn" };
  }
  return { kind: "none" };
}

/** Status van een target: slechtste gemeten check; erkende checks tellen als ok. */
export function targetStatus(
  latestPerCheck: Array<{ check_key: string; status: CheckStatus }>,
  acknowledgedChecks: Set<string>,
): CheckStatus {
  const rank: Record<string, number> = { ok: 0, warn: 1, fail: 2 };
  let worst: CheckStatus | null = null;
  for (const r of latestPerCheck) {
    if (r.status === "unknown") continue;
    const s: CheckStatus = acknowledgedChecks.has(r.check_key) ? "ok" : r.status;
    if (worst === null || rank[s] > rank[worst]) worst = s;
  }
  return worst ?? "unknown";
}

const CHECK_NAME: Record<string, string> = {
  http: "Bereikbaarheid",
  ssl: "Certificaat",
  dns: "Mail-DNS (SPF/DMARC)",
  health: "Health",
  form_smoke: "Formulier",
  domain: "Domeinnaam",
  store: "Winkel",
  odoo: "Odoo-API",
};

export function checkName(checkKey: string): string {
  return CHECK_NAME[checkKey] ?? checkKey;
}

/** Labels voor checks die projecten zelf rapporteren via hun health-endpoint. */
const HEALTH_LABEL: Record<string, string> = {
  mail_sync: "mail-sync",
  stalled_syncs: "vastgelopen syncs",
  recent_sync_errors: "sync-fouten",
  gave_up_uids: "opgegeven berichten",
  form_activity: "formulieren stil",
  open_invites: "openstaande uitnodigingen",
  notify_failures: "mislukte notificaties",
  honeypot_hits: "spam-pogingen",
  suppressed_recent: "onderdrukte mails",
  cron_reminders: "herinneringscron",
  cron_http: "cron-aanroepen falen",
  cron_jobs: "cronjobs falen",
  payments: "betaalanomalie",
  odoo_sync: "Odoo-sync",
  email: "mails komen niet aan",
  webhooks: "webhooks falen",
};

export function healthLabel(key: string): string {
  return HEALTH_LABEL[key] ?? key.replace(/_/g, " ");
}

/** ISO-tijdstippen in vrije tekst leesbaar maken (2026-07-29T20:52:05Z → 29/07). */
export function humanizeText(text: string): string {
  return text.replace(/(\d{4})-(\d{2})-(\d{2})T[\d:.]+Z?/g, (_m, _y, mo, d) => `${d}/${mo}`);
}

/** Eén regel over de laatste meting, ook als alles goed is. */
export function statusLine(checkKey: string, status: CheckStatus, detail: unknown, latencyMs?: number | null): string {
  if (status !== "ok") return describe(checkKey, status, detail).summary || describe(checkKey, status, detail).title;
  const d = (detail && typeof detail === "object" ? detail : {}) as Record<string, unknown>;
  switch (checkKey) {
    case "http":
      return typeof latencyMs === "number" ? `Antwoordt in ${(latencyMs / 1000).toFixed(1).replace(".", ",")} s` : "Antwoordt";
    case "ssl":
      if (d.managed_by === "lovable") return "Beheerd door Lovable, niets te doen";
      return typeof d.days_left === "number" ? `Nog ${d.days_left} dagen geldig` : "Geldig";
    case "dns":
      return "SPF en DMARC staan goed";
    case "odoo":
      return `Versie ${d.serie ?? "?"} · oud /jsonrpc-adres werkt nog${d.json2_exists ? " · JSON-2 beschikbaar" : ""}`;
    case "store":
      return `${d.products_visible ?? "?"}+ producten zichtbaar, ${d.shipping_methods ?? "?"} verzendmethode(s) — afrekenen kan`;
    case "domain":
      return typeof d.expires_at === "string" ? `Geregistreerd tot ${new Date(d.expires_at).toLocaleDateString("nl-BE")}` : "Geregistreerd";
    case "health":
      return "Alle interne checks in orde";
    default:
      return "In orde";
  }
}

/** Mensentaal-titel + samenvatting voor een incident. */
export function describe(
  checkKey: string,
  status: CheckStatus,
  detail: unknown,
): { title: string; summary: string } {
  const d = (detail && typeof detail === "object" ? detail : {}) as Record<string, unknown>;
  if (status === "unknown") {
    return {
      title: `Watchtower kan ${checkName(checkKey).toLowerCase()} niet meten`,
      summary: typeof d.error === "string" ? d.error : "meting mislukt",
    };
  }
  switch (checkKey) {
    case "http": {
      if (typeof d.error === "string") return { title: "Site onbereikbaar", summary: d.error };
      const pageTitle = typeof d.title === "string" ? `paginatitel: “${d.title}”` : "";
      if (d.content_issue === "error_page") return { title: "Site toont een foutpagina", summary: pageTitle };
      if (d.content_issue === "empty_page") return { title: "Site toont een lege pagina", summary: "kapotte of lege deploy?" };
      if (d.content_issue === "maintenance") return { title: "Site staat offline / in onderhoud", summary: pageTitle };
      if (d.content_issue === "default_title")
        return { title: "Standaard-paginatitel", summary: `${pageTitle} — lege deploy of vergeten SEO-titel?` };
      const code = typeof d.http_status === "number" ? d.http_status : null;
      if (status === "fail") return { title: "Site geeft een fout", summary: `HTTP ${code ?? "?"}` };
      if (code && code >= 400) return { title: "Site weigert toegang", summary: `HTTP ${code}` };
      return { title: "Site traag", summary: "antwoord trager dan 5 seconden" };
    }
    case "ssl": {
      const days = typeof d.days_left === "number" ? d.days_left : null;
      if (days !== null && days < 0) return { title: "Certificaat verlopen", summary: `sinds ${-days} dagen` };
      return {
        title: `Certificaat verloopt over ${days ?? "?"} dagen`,
        summary: typeof d.expires_at === "string" ? `vervalt ${d.expires_at.slice(0, 10)}` : "",
      };
    }
    case "dns": {
      const missing = [d.spf === false ? "SPF" : null, d.dmarc === false ? "DMARC" : null].filter(Boolean);
      return {
        title: `${missing.join(" en ") || "Mail-DNS"} ontbreekt`,
        summary: "mail van dit domein kan in spam belanden",
      };
    }
    case "health": {
      const checks = Array.isArray(d.checks) ? (d.checks as Array<Record<string, unknown>>) : [];
      const bad = checks.filter((c) => c && (c.status === "fail" || c.status === "warn"));
      if (typeof d.error === "string") return { title: "Health-endpoint antwoordt niet", summary: d.error };
      const labels = bad.map((c) => healthLabel(String(c.key ?? c.name ?? "check")));
      const first = labels[0] ? labels[0][0].toUpperCase() + labels[0].slice(1) : "";
      return {
        title: labels.length ? [first, ...labels.slice(1)].join(", ") : "Health meldt een probleem",
        summary: humanizeText(
          bad
            .map((c) => (typeof c.detail === "string" ? c.detail : ""))
            .filter(Boolean)
            .join(" · "),
        ).slice(0, 300),
      };
    }
    case "odoo": {
      const v = typeof d.serie === "string" ? ` (versie ${d.serie})` : "";
      if (d.issue === "jsonrpc_removed")
        return { title: "Odoo heeft /jsonrpc geschrapt", summary: `De SellQo-boekhoudsync (facturen, Peppol) werkt niet meer${v}. Migratie naar JSON-2 nodig.` };
      if (d.issue === "odoo_down") return { title: "Odoo onbereikbaar", summary: typeof d.error === "string" ? d.error : `HTTP ${d.jsonrpc_status ?? "?"}` };
      if (d.issue === "deprecated_major")
        return { title: `Odoo staat op versie ${d.major}: /jsonrpc op de schrapbank`, summary: `Werkt nog, maar kan elk moment verdwijnen${v}. Migreer de sync naar JSON-2.` };
      return { title: "Odoo-API meldt een probleem", summary: "" };
    }
    case "store": {
      if (typeof d.error === "string") return { title: "Winkel-API werkt niet", summary: `${d.error} — klanten zien geen producten of kunnen niet afrekenen` };
      if (d.issue === "no_products") return { title: "Geen producten zichtbaar in de winkel", summary: "de storefront geeft een lege productlijst" };
      if (d.issue === "no_shipping") return { title: "Geen verzendmethode naar België", summary: "klanten kunnen niet afrekenen" };
      if (d.issue === "no_prices") return { title: "Producten zonder prijs", summary: "de eerste producten in de winkel hebben geen prijs" };
      return { title: "Winkel meldt een probleem", summary: "" };
    }
    case "domain": {
      const days = typeof d.days_left === "number" ? d.days_left : null;
      return {
        title: days !== null && days < 0 ? "Domeinnaam verlopen" : `Domeinnaam verloopt over ${days ?? "?"} dagen`,
        summary: `${typeof d.domain === "string" ? d.domain : ""}${typeof d.expires_at === "string" ? ` — vervalt ${new Date(d.expires_at).toLocaleDateString("nl-BE", { timeZone: "Europe/Brussels" })}` : ""}; check of auto-renew aan staat`,
      };
    }
    case "form_smoke":
      return { title: "Formulierpagina geeft een fout", summary: typeof d.error === "string" ? d.error : `HTTP ${d.http_status ?? "?"}` };
    default:
      return { title: `${checkName(checkKey)}: ${status}`, summary: "" };
  }
}
