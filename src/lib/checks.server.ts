/**
 * Watchtower checks (server-only, draait in de Cloudflare Worker-runtime).
 *
 * Grondregel: een check meet de property, niet de monitor. Kan de monitor
 * iets niet meten (externe dienst plat, rate limit, timeout bij een derde
 * partij), dan is de uitkomst `unknown` — nooit `warn`. Alleen wat de
 * property zelf doet of laat (niet bereikbaar, cert verloopt, SPF ontbreekt)
 * mag ok/warn/fail kleuren.
 */
import type { Json } from "@/integrations/supabase/types";

export type CheckStatus = "ok" | "warn" | "fail" | "unknown";

export type CheckOutcome = {
  check_key: string;
  status: CheckStatus;
  latency_ms: number | null;
  detail: Json;
};

export type Fetcher = typeof fetch;

const UA = "NomadixWatchtower/2.0";

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function fetchWithTimeout(
  url: string,
  ms: number,
  headers: Record<string, string> = {},
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetcher(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, ...headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- http

export const HTTP_SLOW_MS = 5000;

export async function checkHttp(url: string, fetcher: Fetcher = fetch): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(url, 15000, {}, fetcher);
    const latency = Date.now() - started;
    let status: CheckStatus = "ok";
    if (res.status >= 500 || res.status === 404 || res.status === 410) status = "fail";
    else if (res.status >= 400) status = "warn";
    else if (latency > HTTP_SLOW_MS) status = "warn";
    return { check_key: "http", status, latency_ms: latency, detail: { http_status: res.status, url } };
  } catch (e) {
    // De site zelf antwoordt niet (DNS, TLS, timeout): dat is de property.
    return {
      check_key: "http",
      status: "fail",
      latency_ms: Date.now() - started,
      detail: { error: errMsg(e), url },
    };
  }
}

// ---------------------------------------------------------------- ssl

export const SSL_WARN_DAYS = 14;
export const SSL_FAIL_DAYS = 5;

/** Hosts waarvan het certificaat door het platform beheerd wordt. */
export function isPlatformManagedTls(host: string): boolean {
  return host.endsWith(".lovable.app");
}

function sslStatus(daysLeft: number): CheckStatus {
  if (daysLeft < SSL_FAIL_DAYS) return "fail";
  if (daysLeft < SSL_WARN_DAYS) return "warn";
  return "ok";
}

type CertSpotterIssuance = { id?: string; not_after?: string; revoked?: boolean };

async function expiryFromCertSpotter(host: string, fetcher: Fetcher): Promise<number> {
  let after = "";
  let best = NaN;
  for (let page = 0; page < 5; page++) {
    const q = `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(host)}&match_wildcards=true${after ? `&after=${after}` : ""}`;
    const res = await fetchWithTimeout(q, 15000, {}, fetcher);
    if (!res.ok) throw new Error(`certspotter status ${res.status}`);
    const rows = (await res.json()) as CertSpotterIssuance[];
    for (const r of rows) {
      if (r.revoked) continue;
      const t = r.not_after ? Date.parse(r.not_after) : NaN;
      if (Number.isFinite(t) && !(t <= best)) best = t;
    }
    if (rows.length < 100 || !rows.at(-1)?.id) break;
    after = rows.at(-1)!.id!;
  }
  if (!Number.isFinite(best)) throw new Error("certspotter: geen certificaten gevonden");
  return best;
}

async function expiryFromCrtSh(host: string, fetcher: Fetcher): Promise<number> {
  const res = await fetchWithTimeout(
    `https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired`,
    20000,
    {},
    fetcher,
  );
  if (!res.ok) throw new Error(`crt.sh status ${res.status}`);
  const rows = (await res.json()) as Array<{ not_after?: string }>;
  const dates = rows
    .map((r) => (r.not_after ? Date.parse(`${r.not_after}Z`) : NaN))
    .filter((n) => Number.isFinite(n));
  if (!dates.length) throw new Error("crt.sh: geen certificaten gevonden");
  return Math.max(...dates);
}

export async function checkSsl(url: string, fetcher: Fetcher = fetch): Promise<CheckOutcome> {
  const host = hostOf(url);
  if (isPlatformManagedTls(host)) {
    return {
      check_key: "ssl",
      status: "ok",
      latency_ms: null,
      detail: { host, managed_by: "lovable", note: "certificaat beheerd door Lovable" },
    };
  }
  const errors: string[] = [];
  for (const [source, fn] of [
    ["certspotter", expiryFromCertSpotter],
    ["crt.sh", expiryFromCrtSh],
  ] as const) {
    try {
      const expiresAt = await fn(host, fetcher);
      const daysLeft = Math.floor((expiresAt - Date.now()) / 86400000);
      return {
        check_key: "ssl",
        status: sslStatus(daysLeft),
        latency_ms: null,
        detail: { host, days_left: daysLeft, expires_at: new Date(expiresAt).toISOString(), source },
      };
    } catch (e) {
      errors.push(errMsg(e));
    }
  }
  return {
    check_key: "ssl",
    status: "unknown",
    latency_ms: null,
    detail: { host, error: "vervaldatum kon niet bepaald worden", errors },
  };
}

// ---------------------------------------------------------------- dns

async function txtVia(provider: "cloudflare" | "google", name: string, fetcher: Fetcher): Promise<string[]> {
  const url =
    provider === "cloudflare"
      ? `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`
      : `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`;
  const res = await fetchWithTimeout(url, 10000, { accept: "application/dns-json" }, fetcher);
  if (!res.ok) throw new Error(`${provider} DoH status ${res.status}`);
  const json = (await res.json()) as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
  // Status 3 = NXDOMAIN: het record bestaat niet, dat is een geldig antwoord.
  if (json.Status !== 0 && json.Status !== 3) throw new Error(`${provider} DoH rcode ${json.Status}`);
  return (json.Answer ?? [])
    .filter((a) => a.type === undefined || a.type === 16)
    .map((a) => (a.data ?? "").replace(/"\s*"/g, "").replace(/"/g, ""));
}

async function txtRecords(name: string, fetcher: Fetcher): Promise<string[]> {
  try {
    return await txtVia("cloudflare", name, fetcher);
  } catch (first) {
    try {
      return await txtVia("google", name, fetcher);
    } catch (second) {
      throw new Error(`${errMsg(first)}; ${errMsg(second)}`);
    }
  }
}

export async function checkDns(url: string, fetcher: Fetcher = fetch): Promise<CheckOutcome> {
  const host = hostOf(url).replace(/^www\./, "");
  try {
    const [spfRecords, dmarcRecords] = await Promise.all([
      txtRecords(host, fetcher),
      txtRecords(`_dmarc.${host}`, fetcher),
    ]);
    const spf = spfRecords.some((r) => r.toLowerCase().startsWith("v=spf1"));
    const dmarc = dmarcRecords.some((r) => r.toUpperCase().startsWith("V=DMARC1"));
    return {
      check_key: "dns",
      status: spf && dmarc ? "ok" : "warn",
      latency_ms: null,
      detail: { host, spf, dmarc },
    };
  } catch (e) {
    return { check_key: "dns", status: "unknown", latency_ms: null, detail: { host, error: errMsg(e) } };
  }
}

// ---------------------------------------------------------------- health

export async function checkHealth(
  healthUrl: string,
  token: string | null,
  fetcher: Fetcher = fetch,
): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(healthUrl, 15000, token ? { "x-health-token": token } : {}, fetcher);
    const latency = Date.now() - started;
    const text = await res.text();
    if (res.status !== 200) {
      return {
        check_key: "health",
        status: "fail",
        latency_ms: latency,
        detail: { error: `HTTP ${res.status}`, body: text.slice(0, 500), url: healthUrl },
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        check_key: "health",
        status: "fail",
        latency_ms: latency,
        detail: { error: "ongeldige JSON", body: text.slice(0, 500), url: healthUrl },
      };
    }
    const reported = (json as { status?: string })?.status;
    const known = reported === "ok" || reported === "warn" || reported === "fail";
    return {
      check_key: "health",
      status: known ? (reported as CheckStatus) : "fail",
      latency_ms: latency,
      detail: known
        ? (json as Json)
        : ({ ...(json as Record<string, Json>), error: `onbekende status: ${String(reported)}` } as Json),
    };
  } catch (e) {
    return {
      check_key: "health",
      status: "fail",
      latency_ms: Date.now() - started,
      detail: { error: errMsg(e), url: healthUrl },
    };
  }
}

// ---------------------------------------------------------------- form smoke

export async function checkFormSmoke(smokeUrl: string, fetcher: Fetcher = fetch): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(smokeUrl, 15000, {}, fetcher);
    return {
      check_key: "form_smoke",
      status: res.status >= 400 ? "fail" : "ok",
      latency_ms: Date.now() - started,
      detail: { http_status: res.status, url: smokeUrl },
    };
  } catch (e) {
    return {
      check_key: "form_smoke",
      status: "fail",
      latency_ms: Date.now() - started,
      detail: { error: errMsg(e), url: smokeUrl },
    };
  }
}
