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
      return 8 * MIN;
    case "http":
      return target.kind === "platform" || target.kind === "storefront" ? 8 * MIN : 55 * MIN;
    case "ssl":
    case "dns":
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
  if (checkKey === "health") return 2;
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
};

export function checkName(checkKey: string): string {
  return CHECK_NAME[checkKey] ?? checkKey;
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
      return {
        title: bad.length ? `Health: ${bad.map((c) => String(c.key ?? c.name ?? "check")).join(", ")}` : "Health meldt een probleem",
        summary: bad
          .map((c) => (typeof c.detail === "string" ? c.detail : ""))
          .filter(Boolean)
          .join(" · ")
          .slice(0, 300),
      };
    }
    case "form_smoke":
      return { title: "Formulierpagina geeft een fout", summary: typeof d.error === "string" ? d.error : `HTTP ${d.http_status ?? "?"}` };
    default:
      return { title: `${checkName(checkKey)}: ${status}`, summary: "" };
  }
}
