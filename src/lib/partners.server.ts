/**
 * Partners: statuspagina's van de platformen waar we op draaien of mee koppelen.
 * Statuspage.io-formaat: <url>/api/v2/status.json → { status: { indicator, description } }.
 * indicator: none | minor | major | critical | maintenance
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Upstream = { key: string; partner: string; indicator: string; description: string };

const MIN_INTERVAL_MS = 9 * 60_000;

export async function refreshPartnerStatus(): Promise<{ checked: number; degraded: Upstream[] }> {
  const { data: rows } = await supabaseAdmin
    .from("integrations")
    .select("key, partner, status_page_url, upstream_checked_at, usage_state")
    .not("status_page_url", "is", null);

  // Eén statuspagina per partner (bol_retailer en bol_advertising delen er bv. één).
  const byUrl = new Map<string, { keys: string[]; partner: string; due: boolean }>();
  const now = Date.now();
  for (const r of rows ?? []) {
    const url = r.status_page_url!.replace(/\/$/, "");
    const due = !r.upstream_checked_at || now - Date.parse(r.upstream_checked_at) >= MIN_INTERVAL_MS;
    const e = byUrl.get(url) ?? { keys: [], partner: r.partner, due: false };
    e.keys.push(r.key);
    e.due ||= due;
    byUrl.set(url, e);
  }

  const results = await Promise.all(
    [...byUrl.entries()]
      .filter(([, e]) => e.due)
      .map(async ([url, e]) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          const res = await fetch(`${url}/api/v2/status.json`, {
            signal: controller.signal,
            headers: { accept: "application/json", "user-agent": "NomadixWatchtower/2.0" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as { status?: { indicator?: string; description?: string } };
          return { e, indicator: json.status?.indicator ?? "unknown", description: json.status?.description ?? "" };
        } catch (err) {
          return { e, indicator: "unknown", description: `statuspagina niet bereikbaar: ${err instanceof Error ? err.message : String(err)}` };
        } finally {
          clearTimeout(timer);
        }
      }),
  );

  const checkedAt = new Date().toISOString();
  await Promise.all(
    results.map((r) =>
      supabaseAdmin
        .from("integrations")
        .update({ upstream_indicator: r.indicator, upstream_description: r.description, upstream_checked_at: checkedAt })
        .in("key", r.e.keys),
    ),
  );

  return { checked: results.length, degraded: await degradedPartners() };
}

/** Partners die nu een storing melden (minor of erger), enkel voor koppelingen die we echt gebruiken. */
export async function degradedPartners(): Promise<Upstream[]> {
  const { data } = await supabaseAdmin
    .from("integrations")
    .select("key, partner, upstream_indicator, upstream_description")
    .eq("usage_state", "active")
    .in("upstream_indicator", ["minor", "major", "critical"]);
  const seen = new Set<string>();
  return (data ?? [])
    .filter((r) => (seen.has(r.partner) ? false : (seen.add(r.partner), true)))
    .map((r) => ({ key: r.key, partner: r.partner, indicator: r.upstream_indicator!, description: r.upstream_description ?? "" }));
}

export function upstreamLine(list: Upstream[]): string {
  if (!list.length) return "";
  return list.map((u) => `${u.partner}: ${u.description || u.indicator}`).join(" · ");
}
