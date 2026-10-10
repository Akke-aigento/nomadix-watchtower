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

const ERROR_TITLE =
  /\b(404|500|502|503|504)\b|not found|niet gevonden|application error|bad gateway|service unavailable|internal server error|something went wrong/i;
/** Bewust specifiek: "Tuinaanleg & Onderhoud" is een dienst, geen onderhoudsmodus. */
const MAINTENANCE_TITLE =
  /tijdelijk (offline|niet beschikbaar|gesloten)|\boffline\b|maintenance mode|under maintenance|in onderhoud|wegens onderhoud|under construction|coming soon|binnenkort (online|beschikbaar)/i;
const DEFAULT_TITLE = /^(lovable app|lovable generated project|vite \+ react( \+ ts)?|react app|untitled)$/i;

export type ContentIssue = "error_page" | "maintenance" | "default_title" | "empty_page";

/** Wat zegt de pagina zelf? 200 OK kan nog altijd een foutpagina zijn. */
export function inspectHtml(html: string): { title: string | null; bytes: number; issue: ContentIssue | null } {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = m
    ? m[1]
        .replace(/&amp;/g, "&")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .trim()
    : null;
  const bytes = html.length;
  let issue: ContentIssue | null = null;
  if (title && ERROR_TITLE.test(title)) issue = "error_page";
  else if (title && MAINTENANCE_TITLE.test(title)) issue = "maintenance";
  else if (title && DEFAULT_TITLE.test(title)) issue = "default_title";
  else if (bytes < 200) issue = "empty_page";
  return { title, bytes, issue };
}

export async function checkHttp(url: string, fetcher: Fetcher = fetch): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(url, 15000, {}, fetcher);
    const latency = Date.now() - started;
    let status: CheckStatus = "ok";
    if (res.status >= 500 || res.status === 404 || res.status === 410) status = "fail";
    else if (res.status >= 400) status = "warn";
    else if (latency > HTTP_SLOW_MS) status = "warn";

    let page: ReturnType<typeof inspectHtml> | null = null;
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.includes("text/html")) {
      try {
        page = inspectHtml((await res.text()).slice(0, 200_000));
        if (page.issue === "error_page" || page.issue === "empty_page") status = "fail";
        else if ((page.issue === "maintenance" || page.issue === "default_title") && status === "ok") status = "warn";
      } catch {
        page = null;
      }
    }
    return {
      check_key: "http",
      status,
      latency_ms: latency,
      detail: {
        http_status: res.status,
        url,
        ...(page ? { title: page.title, bytes: page.bytes, content_issue: page.issue } : {}),
      },
    };
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

export async function mxRecords(domain: string, fetcher: Fetcher = fetch): Promise<string[]> {
  const res = await fetchWithTimeout(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
    10000,
    { accept: "application/dns-json" },
    fetcher,
  );
  if (!res.ok) throw new Error(`MX DoH status ${res.status}`);
  const json = (await res.json()) as { Answer?: Array<{ type?: number; data?: string }> };
  return (json.Answer ?? [])
    .filter((a) => a.type === 15)
    .map((a) => (a.data ?? "").split(" ").pop()!.replace(/\.$/, "").toLowerCase());
}

// ---------------------------------------------------------------- domein (RDAP)

export const DOMAIN_WARN_DAYS = 14;
export const DOMAIN_FAIL_DAYS = 3;

/** Registrable domain (eenvoudig: laatste twee labels; genoeg voor .be/.com/.app/.nl). */
export function registrableDomain(host: string): string {
  return host.split(".").slice(-2).join(".");
}

/** TLD's waarvan de registry geen vervaldatum publiceert (DNS Belgium heeft geen RDAP). */
const NO_RDAP_TLDS = new Set(["be"]);

export function supportsDomainCheck(host: string): boolean {
  if (host.endsWith(".lovable.app")) return false;
  return !NO_RDAP_TLDS.has(host.split(".").pop() ?? "");
}

let bootstrap: Promise<Map<string, string>> | null = null;

function rdapBootstrap(fetcher: Fetcher): Promise<Map<string, string>> {
  if (!bootstrap) {
    bootstrap = (async () => {
      const res = await fetchWithTimeout("https://data.iana.org/rdap/dns.json", 15000, {}, fetcher);
      if (!res.ok) throw new Error(`IANA bootstrap status ${res.status}`);
      const json = (await res.json()) as { services: [string[], string[]][] };
      const map = new Map<string, string>();
      for (const [tlds, urls] of json.services) for (const t of tlds) map.set(t, urls[0]);
      return map;
    })().catch((e) => {
      bootstrap = null;
      throw e;
    });
  }
  return bootstrap;
}

export async function checkDomain(url: string, fetcher: Fetcher = fetch): Promise<CheckOutcome> {
  const domain = registrableDomain(hostOf(url));
  const tld = domain.split(".").pop() ?? "";
  try {
    const base = (await rdapBootstrap(fetcher)).get(tld);
    if (!base) throw new Error(`geen RDAP-server voor .${tld}`);
    const res = await fetchWithTimeout(
      `${base.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`,
      15000,
      { accept: "application/rdap+json" },
      fetcher,
    );
    if (!res.ok) throw new Error(`RDAP status ${res.status}`);
    const json = (await res.json()) as { events?: Array<{ eventAction?: string; eventDate?: string }> };
    const exp = json.events?.find((e) => e.eventAction === "expiration")?.eventDate;
    if (!exp) throw new Error("geen vervaldatum in RDAP-antwoord");
    const expiresAt = Date.parse(exp);
    const daysLeft = Math.floor((expiresAt - Date.now()) / 86400000);
    const status: CheckStatus = daysLeft < DOMAIN_FAIL_DAYS ? "fail" : daysLeft < DOMAIN_WARN_DAYS ? "warn" : "ok";
    return {
      check_key: "domain",
      status,
      latency_ms: null,
      detail: { domain, days_left: daysLeft, expires_at: new Date(expiresAt).toISOString() },
    };
  } catch (e) {
    return { check_key: "domain", status: "unknown", latency_ms: null, detail: { domain, error: errMsg(e) } };
  }
}

// ---------------------------------------------------------------- winkel (SellQo storefront)

export const SELLQO_STOREFRONT_API = "https://gczmfcabnoofnmfpzeop.supabase.co/functions/v1/storefront-api";

async function storefront(
  action: string,
  tenantId: string,
  params: Record<string, unknown>,
  fetcher: Fetcher,
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetcher(SELLQO_STOREFRONT_API, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({ action, tenant_id: tenantId, params }),
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: unknown; error?: unknown };
    const err = typeof json.error === "string" ? json.error : json.error ? JSON.stringify(json.error) : undefined;
    return { ok: res.ok && json.success === true, status: res.status, data: json.data, error: err };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kan een klant kopen? Enkel leesacties (geen cart, geen order):
 * producten met prijs zichtbaar + minstens één verzendmethode naar BE.
 */
export async function checkStore(tenantId: string, fetcher: Fetcher = fetch): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const [products, shipping] = await Promise.all([
      storefront("get_products", tenantId, { per_page: 3 }, fetcher),
      storefront("get_shipping_methods", tenantId, { country: "BE" }, fetcher),
    ]);
    const latency = Date.now() - started;
    if (products.status === 429 || shipping.status === 429) {
      return { check_key: "store", status: "unknown", latency_ms: latency, detail: { error: "rate limit storefront-api" } };
    }
    if (!products.ok || !shipping.ok) {
      return {
        check_key: "store",
        status: "fail",
        latency_ms: latency,
        detail: {
          error: products.ok ? `verzendmethodes: HTTP ${shipping.status} ${shipping.error ?? ""}`.trim() : `producten: HTTP ${products.status} ${products.error ?? ""}`.trim(),
        },
      };
    }
    type P = { price?: number | null; price_range?: { min?: number | null } | null };
    const list = ((products.data as { products?: P[] })?.products ?? []) as P[];
    // Producten met varianten hebben price 0 en de echte prijs in price_range (bv. Astra Sleep).
    const withPrice = list.filter(
      (p) => (typeof p.price === "number" && p.price > 0) || (typeof p.price_range?.min === "number" && p.price_range.min > 0),
    ).length;
    const methods = Array.isArray(shipping.data) ? shipping.data.length : 0;
    let status: CheckStatus = "ok";
    let issue: string | null = null;
    if (!list.length) {
      status = "fail";
      issue = "no_products";
    } else if (!methods) {
      status = "fail";
      issue = "no_shipping";
    } else if (!withPrice) {
      status = "warn";
      issue = "no_prices";
    }
    return {
      check_key: "store",
      status,
      latency_ms: latency,
      detail: { products_visible: list.length, with_price: withPrice, shipping_methods: methods, issue },
    };
  } catch (e) {
    // Onze eigen fetch faalde (timeout naar Supabase): dat is SellQo zelf.
    return { check_key: "store", status: "fail", latency_ms: Date.now() - started, detail: { error: errMsg(e) } };
  }
}

// ---------------------------------------------------------------- odoo (API-kanarie)

/**
 * Bestaat het oude /jsonrpc-adres nog, en op welke versie draait de database?
 * Beide zonder login. Odoo schrapt /xmlrpc + /jsonrpc vanaf Odoo 20; JSON-2 (/json/2) is de opvolger.
 *  - fail : /jsonrpc weg (404/geen result) → SellQo-boekhoudsync ligt plat
 *  - warn : database op 20+ terwijl /jsonrpc nog antwoordt → op de schrapbank, migreren
 *  - ok   : /jsonrpc leeft, versie < 20
 */
export async function checkOdoo(baseUrl: string, fetcher: Fetcher = fetch): Promise<CheckOutcome> {
  const started = Date.now();
  const base = baseUrl.replace(/\/$/, "");
  const call = async (path: string, body: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetcher(`${base}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "user-agent": UA },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { result?: { server_serie?: string; server_version?: string } } | null;
      return { status: res.status, result: json?.result ?? null };
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const [rpc, json2] = await Promise.all([
      call("/jsonrpc", { jsonrpc: "2.0", method: "call", params: { service: "common", method: "version", args: [] } }),
      call("/json/2/res.users/context_get", {}),
    ]);
    const latency = Date.now() - started;
    const serie = rpc.result?.server_serie ?? null;
    const major = serie ? Number((serie.match(/(\d+)/) ?? [])[1]) : null;
    const rpcAlive = rpc.status === 200 && !!rpc.result;
    const json2Exists = json2.status === 401 || json2.status === 200;
    const detail = { url: base, serie, major, jsonrpc_alive: rpcAlive, jsonrpc_status: rpc.status, json2_exists: json2Exists };
    if (!rpcAlive) {
      // Ligt heel Odoo plat (5xx/timeout) of enkel /jsonrpc weg? Beide breken de sync.
      return { check_key: "odoo", status: "fail", latency_ms: latency, detail: { ...detail, issue: rpc.status >= 500 ? "odoo_down" : "jsonrpc_removed" } };
    }
    if (major !== null && major >= 20) {
      return { check_key: "odoo", status: "warn", latency_ms: latency, detail: { ...detail, issue: "deprecated_major" } };
    }
    return { check_key: "odoo", status: "ok", latency_ms: latency, detail };
  } catch (e) {
    return { check_key: "odoo", status: "fail", latency_ms: Date.now() - started, detail: { url: base, error: errMsg(e), issue: "odoo_down" } };
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
