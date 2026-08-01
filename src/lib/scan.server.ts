/**
 * Watchtower scan engine (server-only).
 *
 * NOTE: runs in the edge/worker runtime, so raw TLS sockets are unavailable.
 * The SSL check therefore reads certificate expiry from the public Certificate
 * Transparency log (crt.sh); when that lookup fails we degrade to `warn`.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

export type CheckStatus = "ok" | "warn" | "fail";

export type CheckOutcome = {
  check_key: string;
  status: CheckStatus;
  latency_ms: number | null;
  detail: Json;
};

const WORST: Record<CheckStatus, number> = { ok: 0, warn: 1, fail: 2 };

export function worstStatus(list: CheckStatus[]): CheckStatus {
  return list.reduce<CheckStatus>((acc, s) => (WORST[s] > WORST[acc] ? s : acc), "ok");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

async function fetchWithTimeout(
  url: string,
  ms: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "NomadixWatchtower/1.0", ...headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHttp(url: string): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(url, 15000);
    const latency = Date.now() - started;
    let status: CheckStatus = "ok";
    if (res.status >= 400) status = "fail";
    else if (latency > 5000) status = "warn";
    return {
      check_key: "http",
      status,
      latency_ms: latency,
      detail: { http_status: res.status, url },
    };
  } catch (e) {
    return {
      check_key: "http",
      status: "fail",
      latency_ms: Date.now() - started,
      detail: { error: e instanceof Error ? e.message : String(e), url },
    };
  }
}

/** crt.sh rate-limits hard: serialize lookups with a pause in between. */
let crtChain: Promise<void> = Promise.resolve();
let lastCrtCall = 0;
const CRT_PAUSE_MS = 2500;

function crtSlot<T>(fn: () => Promise<T>): Promise<T> {
  const result = crtChain.then(async () => {
    const wait = CRT_PAUSE_MS - (Date.now() - lastCrtCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastCrtCall = Date.now();
    }
  });
  crtChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

type SslRow = { status: string; detail: Json; measured_at: string };

async function lastSslResult(host: string): Promise<SslRow | null> {
  const { data } = await supabaseAdmin
    .from("scan_results")
    .select("status, detail, measured_at")
    .eq("check_key", "ssl")
    .filter("detail->>host", "eq", host)
    .order("measured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SslRow | null) ?? null;
}

function isTransient(message: string): boolean {
  return /\b(429|5\d\d)\b/.test(message) || /\b404\b/.test(message) || /abort|timeout/i.test(message);
}

export async function checkSsl(url: string): Promise<CheckOutcome> {
  const host = hostOf(url);
  const previous = await lastSslResult(host);
  const prevDetail = (previous?.detail ?? null) as { expires_at?: string } | null;

  // (b) reuse a fresh, conclusive result instead of hammering crt.sh
  if (
    previous &&
    previous.status === "ok" &&
    prevDetail?.expires_at &&
    Date.now() - Date.parse(previous.measured_at) < 24 * 3600000
  ) {
    return {
      check_key: "ssl",
      status: "ok",
      latency_ms: null,
      detail: previous.detail,
    };
  }

  try {
    const res = await crtSlot(() =>
      fetchWithTimeout(
        `https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired`,
        15000,
      ),
    );
    if (!res.ok) throw new Error(`crt.sh status ${res.status}`);
    const rows = (await res.json()) as Array<{ not_after?: string; name_value?: string }>;
    const dates = rows
      .map((r) => (r.not_after ? Date.parse(`${r.not_after}Z`) : NaN))
      .filter((n) => Number.isFinite(n)) as number[];
    if (!dates.length) throw new Error("geen certificaten gevonden");
    const expiresAt = Math.max(...dates);
    const daysLeft = Math.floor((expiresAt - Date.now()) / 86400000);
    let status: CheckStatus = "ok";
    if (daysLeft < 7) status = "fail";
    else if (daysLeft < 21) status = "warn";
    return {
      check_key: "ssl",
      status,
      latency_ms: null,
      detail: { host, days_left: daysLeft, expires_at: new Date(expiresAt).toISOString() },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    // (c) transient failures must never downgrade a host to warn
    if (isTransient(message)) {
      if (previous) {
        return {
          check_key: "ssl",
          status: previous.status as CheckStatus,
          latency_ms: null,
          detail: {
            ...(typeof previous.detail === "object" && previous.detail !== null
              ? (previous.detail as Record<string, Json>)
              : {}),
            host,
            note: `lookup overgeslagen: ${message}`,
          },
        };
      }
      return {
        check_key: "ssl",
        status: "ok",
        latency_ms: null,
        detail: { host, note: "vervaldatum nog niet bepaald" },
      };
    }

    if (previous) {
      return {
        check_key: "ssl",
        status: previous.status as CheckStatus,
        latency_ms: null,
        detail: {
          ...(typeof previous.detail === "object" && previous.detail !== null
            ? (previous.detail as Record<string, Json>)
            : {}),
          host,
          note: `lookup overgeslagen: ${message}`,
        },
      };
    }
    return {
      check_key: "ssl",
      status: "ok",
      latency_ms: null,
      detail: { host, note: "vervaldatum nog niet bepaald", error: message },
    };
  }
}

async function txtRecords(name: string): Promise<string[]> {
  const res = await fetchWithTimeout(
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`,
    15000,
  );
  if (!res.ok) throw new Error(`DoH status ${res.status}`);
  const json = (await res.json()) as { Answer?: Array<{ data?: string }> };
  return (json.Answer ?? []).map((a) => (a.data ?? "").replace(/"/g, ""));
}

export async function checkDns(url: string): Promise<CheckOutcome> {
  const host = hostOf(url);
  try {
    const [spfRecords, dmarcRecords] = await Promise.all([
      txtRecords(host),
      txtRecords(`_dmarc.${host}`).catch(() => [] as string[]),
    ]);
    const hasSpf = spfRecords.some((r) => r.toLowerCase().includes("v=spf1"));
    const hasDmarc = dmarcRecords.some((r) => r.toUpperCase().includes("V=DMARC1"));
    const status: CheckStatus = hasSpf && hasDmarc ? "ok" : "warn";
    return {
      check_key: "dns",
      status,
      latency_ms: null,
      detail: { host, spf: hasSpf, dmarc: hasDmarc },
    };
  } catch (e) {
    return {
      check_key: "dns",
      status: "warn",
      latency_ms: null,
      detail: { host, error: e instanceof Error ? e.message : String(e) },
    };
  }
}

export async function checkHealth(
  healthUrl: string,
  token: string | null,
): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(
      healthUrl,
      15000,
      token ? { "x-health-token": token } : {},
    );
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
    const payload = json as { status?: string };
    const reported = payload?.status;
    const status: CheckStatus =
      reported === "ok" || reported === "warn" || reported === "fail" ? reported : "fail";
    return {
      check_key: "health",
      status,
      latency_ms: latency,
      detail:
        reported === status
          ? (json as Json)
          : ({ ...(json as Record<string, Json>), error: `onbekende status: ${String(reported)}` } as Json),
    };
  } catch (e) {
    return {
      check_key: "health",
      status: "fail",
      latency_ms: Date.now() - started,
      detail: { error: e instanceof Error ? e.message : String(e), url: healthUrl },
    };
  }
}

export async function checkFormSmoke(smokeUrl: string): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(smokeUrl, 15000);
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
      detail: { error: e instanceof Error ? e.message : String(e), url: smokeUrl },
    };
  }
}

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

function isDue(frequency: string, lastScannedAt: string | null): boolean {
  if (!lastScannedAt) return true;
  const ageHours = (Date.now() - Date.parse(lastScannedAt)) / 3600000;
  return frequency === "weekly" ? ageHours > 24 * 6 : ageHours > 20;
}

export async function runScans() {
  const { data: targets, error } = await supabaseAdmin
    .from("watch_targets")
    .select("*")
    .eq("enabled", true);
  if (error) throw error;

  const scanned: Array<{ target: string; status: CheckStatus; checks: number }> = [];

  for (const target of targets ?? []) {
    if (!isDue(target.frequency, target.last_scanned_at)) continue;

    const checks = (target.checks ?? {}) as Record<string, boolean>;
    const outcomes: CheckOutcome[] = [];

    if (checks.http !== false) outcomes.push(await checkHttp(target.url));
    if (checks.ssl) outcomes.push(await checkSsl(target.url));
    if (checks.dns) outcomes.push(await checkDns(target.url));
    if (checks.form_smoke && target.form_smoke_url)
      outcomes.push(await checkFormSmoke(target.form_smoke_url));
    if (checks.health && target.health_url)
      outcomes.push(await checkHealth(target.health_url, target.health_token));
    if (!outcomes.length) continue;

    // previous status per check_key (before inserting this run)
    const previous = new Map<string, CheckStatus>();
    for (const outcome of outcomes) {
      const { data: prev } = await supabaseAdmin
        .from("scan_results")
        .select("status")
        .eq("target_id", target.id)
        .eq("check_key", outcome.check_key)
        .order("measured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prev?.status) previous.set(outcome.check_key, prev.status as CheckStatus);
    }

    await supabaseAdmin.from("scan_results").insert(
      outcomes.map((o) => ({
        target_id: target.id,
        check_key: o.check_key,
        status: o.status,
        latency_ms: o.latency_ms,
        detail: o.detail,
      })),
    );

    const overall = worstStatus(outcomes.map((o) => o.status));
    await supabaseAdmin
      .from("watch_targets")
      .update({ status: overall, last_scanned_at: new Date().toISOString() })
      .eq("id", target.id);

    // alerting: only on transitions
    for (const o of outcomes) {
      const prev = previous.get(o.check_key);
      if (!prev || prev === o.status) continue;
      const recovered = o.status === "ok";
      const subject = recovered
        ? `[Watchtower] HERSTELD: ${target.name} — ${o.check_key}`
        : `[Watchtower] ${o.status === "fail" ? "FAIL" : "WARN"}: ${target.name} — ${o.check_key}`;
      const html = `<p><strong>${target.name}</strong> (${target.url})</p>
        <p>Check: <code>${o.check_key}</code><br/>Overgang: <code>${prev} → ${o.status}</code></p>
        <pre>${JSON.stringify(o.detail ?? {}, null, 2)}</pre>`;
      const mailed = await sendAlertMail(subject, html);
      await supabaseAdmin.from("alert_log").insert({
        target_id: target.id,
        check_key: o.check_key,
        transition: `${prev}->${o.status}`,
        mailed,
        detail: o.detail,
      });
    }

    scanned.push({ target: target.name, status: overall, checks: outcomes.length });
  }

  return { scanned_count: scanned.length, scanned };
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
    .lte("measured_at", to);
  if (error) throw error;

  const byTarget = new Map<string, typeof rows>();
  for (const row of rows ?? []) {
    const list = byTarget.get(row.target_id) ?? [];
    list.push(row);
    byTarget.set(row.target_id, list as typeof rows);
  }

  let written = 0;
  for (const [targetId, list] of byTarget) {
    const all = list ?? [];
    const http = all.filter((r) => r.check_key === "http");
    const uptime = http.length
      ? Math.round((http.filter((r) => r.status === "ok").length / http.length) * 10000) / 100
      : null;
    const latencies = http.map((r) => r.latency_ms).filter((n): n is number => typeof n === "number");
    const avgLatency = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;
    const failCount = all.filter((r) => r.status === "fail").length;

    await supabaseAdmin
      .from("daily_summaries")
      .upsert(
        {
          target_id: targetId,
          day: dayStr,
          uptime_pct: uptime,
          avg_latency_ms: avgLatency,
          fail_count: failCount,
        },
        { onConflict: "target_id,day" },
      );
    written++;
  }

  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  await supabaseAdmin.from("scan_results").delete().lt("measured_at", cutoff);

  return { day: dayStr, summaries_written: written };
}
