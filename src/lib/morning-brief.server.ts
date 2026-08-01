/** Ochtendbrief: één compacte HTML-mail met de stand van zaken (server-only). */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendAlertMail } from "@/lib/scan.server";

const BG = "#0b0f14";
const PANEL = "#121820";
const BORDER = "#1f2a36";
const TEXT = "#e6edf3";
const MUTED = "#8b98a5";
const OK = "#3fb950";
const WARN = "#d29922";
const FAIL = "#f85149";

function statusColor(status: string): string {
  return status === "ok" ? OK : status === "warn" ? WARN : status === "fail" ? FAIL : MUTED;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function reasonOf(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "geen detail";
  const d = detail as Record<string, unknown>;
  if (typeof d.error === "string") return d.error;
  if (typeof d.note === "string") return d.note;
  if (typeof d.http_status === "number") return `HTTP ${d.http_status}`;
  if (typeof d.days_left === "number") return `${d.days_left} dagen geldig`;
  if (d.spf === false || d.dmarc === false)
    return `SPF ${d.spf ? "ok" : "ontbreekt"}, DMARC ${d.dmarc ? "ok" : "ontbreekt"}`;
  return JSON.stringify(d).slice(0, 160);
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("nl-BE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

function section(title: string, inner: string): string {
  return `<div style="background:${PANEL};border:1px solid ${BORDER};border-radius:8px;padding:14px 16px;margin:0 0 12px 0">
    <div style="font:600 11px/1.4 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};margin-bottom:10px">${esc(title)}</div>
    ${inner}
  </div>`;
}

export async function morningBrief(): Promise<{ sent: boolean; sections: string[] }> {
  const now = Date.now();
  const since = new Date(now - 24 * 3600000).toISOString();

  const [{ data: targets }, { data: alerts }, { data: proposals }] = await Promise.all([
    supabaseAdmin.from("watch_targets").select("*").eq("enabled", true).order("name"),
    supabaseAdmin
      .from("alert_log")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("proposals")
      .select("*")
      .eq("status", "proposed")
      .order("created_at", { ascending: false }),
  ]);

  const list = targets ?? [];
  const targetById = new Map(list.map((t) => [t.id, t]));

  const { data: recent } = await supabaseAdmin
    .from("scan_results")
    .select("target_id, check_key, status, latency_ms, detail, measured_at")
    .order("measured_at", { ascending: false })
    .limit(1500);

  // laatste resultaat per target+check
  const latest = new Map<string, NonNullable<typeof recent>[number]>();
  for (const row of recent ?? []) {
    const key = `${row.target_id}|${row.check_key}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  const sections: string[] = [];
  const blocks: string[] = [];

  // 1. statusbalk
  const counts = { ok: 0, warn: 0, fail: 0, unknown: 0 } as Record<string, number>;
  for (const t of list) counts[t.status in counts ? t.status : "unknown"]++;
  const problemLines: string[] = [];
  for (const t of list) {
    if (t.status !== "warn" && t.status !== "fail") continue;
    const rows = [...latest.values()].filter(
      (r) => r.target_id === t.id && (r.status === "warn" || r.status === "fail"),
    );
    if (rows.length === 0) {
      problemLines.push(
        `<div style="font:400 13px/1.6 Arial,sans-serif;color:${TEXT}"><span style="color:${statusColor(t.status)}">●</span> ${esc(t.name)} — <span style="color:${MUTED}">status ${esc(t.status)}</span></div>`,
      );
      continue;
    }
    for (const r of rows) {
      problemLines.push(
        `<div style="font:400 13px/1.6 Arial,sans-serif;color:${TEXT}"><span style="color:${statusColor(r.status)}">●</span> ${esc(t.name)} — ${esc(r.check_key)} — <span style="color:${MUTED}">${esc(reasonOf(r.detail))}</span></div>`,
      );
    }
  }
  blocks.push(
    section(
      "Status",
      `<div style="font:600 15px/1.5 Arial,sans-serif;color:${TEXT}">
        <span style="color:${OK}">${counts.ok} ok</span> ·
        <span style="color:${WARN}">${counts.warn} warn</span> ·
        <span style="color:${FAIL}">${counts.fail} fail</span>
      </div>${problemLines.length ? `<div style="margin-top:8px">${problemLines.join("")}</div>` : ""}`,
    ),
  );
  sections.push("status");

  // 2. transities 24u
  if ((alerts ?? []).length > 0) {
    const rows = (alerts ?? [])
      .map((a) => {
        const t = targetById.get(a.target_id);
        const to = a.transition.split("->").at(-1) ?? "unknown";
        return `<div style="font:400 13px/1.6 Arial,sans-serif;color:${TEXT}"><span style="color:${statusColor(to)}">●</span> ${esc(t?.name ?? "onbekend target")} — ${esc(a.check_key)} — <span style="font-family:ui-monospace,Menlo,Consolas,monospace">${esc(a.transition)}</span> <span style="color:${MUTED}">${esc(fmtTime(a.created_at))}</span></div>`;
      })
      .join("");
    blocks.push(section("Transities laatste 24u", rows));
    sections.push("transitions");
  }

  // 3. openstaande proposals
  if ((proposals ?? []).length > 0) {
    const rows = (proposals ?? [])
      .map(
        (p) =>
          `<div style="font:400 13px/1.6 Arial,sans-serif;color:${TEXT};margin-bottom:4px"><span style="display:inline-block;border:1px solid ${BORDER};border-radius:4px;padding:1px 6px;font:600 10px/1.4 ui-monospace,Menlo,Consolas,monospace;text-transform:uppercase;color:${MUTED};margin-right:6px">${esc(p.category)}</span>${esc(p.title)}</div>`,
      )
      .join("");
    blocks.push(section("Wachten op jouw go", rows));
    sections.push("proposals");
  }

  // 4. health-samenvattingen
  const healthTargets = list.filter(
    (t) => !!(t.checks as Record<string, boolean> | null)?.health && !!t.health_url,
  );
  const healthBlocks: string[] = [];
  for (const t of healthTargets) {
    const row = latest.get(`${t.id}|health`);
    if (!row) continue;
    const detail = (row.detail ?? {}) as Record<string, unknown>;
    const checks = Array.isArray(detail.checks) ? (detail.checks as unknown[]) : [];
    const lines = checks
      .map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const label = esc(o.name ?? o.check ?? o.key ?? "check");
        const st = String(o.status ?? "unknown");
        const extra = o.message ?? o.detail ?? o.error;
        return `<div style="font:400 12px/1.6 Arial,sans-serif;color:${TEXT};padding-left:12px"><span style="color:${statusColor(st)}">●</span> ${label}${extra ? ` — <span style="color:${MUTED}">${esc(extra)}</span>` : ""}</div>`;
      })
      .join("");
    healthBlocks.push(
      `<div style="margin-bottom:8px"><div style="font:600 13px/1.6 Arial,sans-serif;color:${TEXT}"><span style="color:${statusColor(row.status)}">●</span> ${esc(t.name)} — ${esc(row.status)}</div>${lines}</div>`,
    );
  }
  if (healthBlocks.length > 0) {
    blocks.push(section("Health", healthBlocks.join("")));
    sections.push("health");
  }

  // 5. traagste 3 op laatste http-latency
  const slow = list
    .map((t) => ({ t, row: latest.get(`${t.id}|http`) }))
    .filter((x): x is { t: (typeof list)[number]; row: NonNullable<typeof x.row> } =>
      typeof x.row?.latency_ms === "number",
    )
    .sort((a, b) => (b.row.latency_ms ?? 0) - (a.row.latency_ms ?? 0))
    .slice(0, 3);
  if (slow.length > 0) {
    const rows = slow
      .map(
        ({ t, row }) =>
          `<div style="font:400 13px/1.6 Arial,sans-serif;color:${TEXT}">${esc(t.name)} — <span style="font-family:ui-monospace,Menlo,Consolas,monospace;color:${MUTED}">${row.latency_ms} ms</span></div>`,
      )
      .join("");
    blocks.push(section("Traagste 3", rows));
    sections.push("slowest");
  }

  const today = new Date();
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const subject = `[Watchtower] Ochtendbrief — ${dd}-${mm}-${today.getUTCFullYear()}`;

  const html = `<div style="background:${BG};padding:20px;font-family:Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto">
      <div style="font:700 16px/1.4 Arial,sans-serif;color:${TEXT};margin-bottom:14px">Nomadix Watchtower — ochtendbrief ${dd}-${mm}-${today.getUTCFullYear()}</div>
      ${blocks.join("")}
    </div>
  </div>`;

  const sent = await sendAlertMail(subject, html);
  return { sent, sections };
}
