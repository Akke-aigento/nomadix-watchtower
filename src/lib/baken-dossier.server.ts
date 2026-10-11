/**
 * Het dossier van Baken: alles wat hij bij de start van een gesprek al moet weten, zodat hij
 * niet dom of traag doet. Erkende incidenten staan er expliciet als erkend in (met Akke's
 * reden), voorstellen met hun pakket, en elke site met haar echte adres.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const day = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("nl-BE", {
        timeZone: "Europe/Brussels",
        day: "numeric",
        month: "short",
      })
    : "?";
const cut = (s: string | null | undefined, n: number) =>
  !s ? "" : s.length > n ? `${s.slice(0, n - 1)}…` : s;

export async function buildDossier(): Promise<string> {
  const now = new Date();
  const in45 = new Date(now.getTime() + 45 * 86400000).toISOString().slice(0, 10);
  const [targets, incidents, proposals, findings, agenda, integrations, credits] =
    await Promise.all([
      supabaseAdmin
        .from("watch_targets")
        .select("id, name, url, kind, status")
        .eq("enabled", true)
        .order("name"),
      supabaseAdmin
        .from("incidents")
        .select(
          "target_id, title, severity, summary, opened_at, acknowledged_until, acknowledged_note",
        )
        .eq("status", "open")
        .order("opened_at"),
      supabaseAdmin
        .from("proposals")
        .select("title, status, bundle, bundle_title, bundle_order, target_id, created_at, result")
        .in("status", ["proposed", "approved", "in_progress", "failed"])
        .order("created_at", { ascending: false })
        .limit(60),
      supabaseAdmin
        .from("findings")
        .select("title, impact, severity, status, effective_date, integration_key")
        .in("status", ["nieuw", "pakket"])
        .order("detected_at", { ascending: false })
        .limit(15),
      supabaseAdmin
        .from("agenda")
        .select("title, due_date, severity")
        .eq("status", "open")
        .lte("due_date", in45)
        .order("due_date")
        .limit(15),
      supabaseAdmin
        .from("integrations")
        .select("name, usage_state, active_tenants, risk, risk_note")
        .or("usage_state.eq.active,risk.neq.ok")
        .order("risk"),
      supabaseAdmin
        .from("credit_latest")
        .select("project_name, exec_s_per_day, drivers")
        .order("exec_s_per_day", { ascending: false })
        .limit(6),
    ]);

  const nameOf = new Map((targets.data ?? []).map((t) => [t.id, t.name]));
  const lines: string[] = [];
  const nowText = now.toLocaleString("nl-BE", {
    timeZone: "Europe/Brussels",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  lines.push(`Nu: ${nowText} (Brussel).`);

  lines.push("\nSITES (naam · soort · status · adres):");
  for (const t of targets.data ?? [])
    lines.push(`- ${t.name} · ${t.kind} · ${t.status} · ${t.url}`);

  const inc = incidents.data ?? [];
  const isAcked = (i: (typeof inc)[number]) =>
    !!i.acknowledged_until && Date.parse(i.acknowledged_until) > now.getTime();
  const live = inc.filter((i) => !isAcked(i) && i.severity !== "monitor");
  const acked = inc.filter(isAcked);
  lines.push("\nOPEN PROBLEMEN DIE AANDACHT VRAGEN:");
  if (!live.length) lines.push("- geen");
  for (const i of live)
    lines.push(
      `- [${i.severity}] ${nameOf.get(i.target_id) ?? "?"}: ${i.title}${i.summary ? ` — ${cut(i.summary, 180)}` : ""} (open sinds ${day(i.opened_at)})`,
    );
  lines.push(
    "\nERKEND DOOR AKKE (geen prioriteit, niet als probleem brengen tenzij hij ernaar vraagt):",
  );
  if (!acked.length) lines.push("- geen");
  for (const i of acked)
    lines.push(
      `- ${nameOf.get(i.target_id) ?? "?"}: ${i.title} — erkend tot ${day(i.acknowledged_until)}, reden: "${i.acknowledged_note ?? "geen reden"}"`,
    );

  const props = proposals.data ?? [];
  const waiting = props.filter((p) => p.status === "proposed");
  const bundles = new Map<string, string[]>();
  for (const p of waiting.filter((p) => p.bundle))
    bundles.set(p.bundle_title ?? p.bundle!, [
      ...(bundles.get(p.bundle_title ?? p.bundle!) ?? []),
      p.title,
    ]);
  lines.push(`\nVOORSTELLEN die op go wachten: ${waiting.length}.`);
  for (const [title, steps] of bundles) lines.push(`- Pakket "${title}": ${steps.length} stappen`);
  for (const p of waiting.filter((p) => !p.bundle).slice(0, 15))
    lines.push(`- ${p.title}${p.target_id ? ` (${nameOf.get(p.target_id) ?? ""})` : ""}`);
  const busy = props.filter((p) => p.status !== "proposed");
  if (busy.length) {
    lines.push("Go gegeven / bezig / jouw beurt:");
    for (const p of busy.slice(0, 8))
      lines.push(`- [${p.status}] ${p.title}${p.result ? ` — ${cut(p.result, 140)}` : ""}`);
  }

  lines.push("\nVONDSTEN BIJ PARTNERS (open):");
  if (!(findings.data ?? []).length) lines.push("- geen");
  for (const f of findings.data ?? [])
    lines.push(
      `- [${f.severity}, ${f.impact}${f.status === "pakket" ? ", pakket klaar" : ""}] ${f.title}${f.effective_date ? ` (vanaf ${day(f.effective_date)})` : ""}`,
    );

  lines.push("\nAGENDA (te laat of binnen 45 dagen):");
  if (!(agenda.data ?? []).length) lines.push("- niets");
  for (const a of agenda.data ?? []) {
    const late = Math.round((now.getTime() - Date.parse(a.due_date)) / 86400000);
    lines.push(
      `- ${day(a.due_date)} ${a.due_date.slice(0, 4)}${late > 0 ? ` (${late} dagen te laat)` : ""}: ${a.title} [${a.severity}]`,
    );
  }

  lines.push("\nKOPPELINGEN (in gebruik of met risico):");
  for (const i of integrations.data ?? [])
    lines.push(
      `- ${i.name}: ${i.usage_state}${i.active_tenants ? `, ${i.active_tenants} tenant(s)` : ""}, risico ${i.risk}${i.risk_note ? ` — ${cut(i.risk_note, 160)}` : ""}`,
    );

  if ((credits.data ?? []).length) {
    lines.push("\nLOVABLE-REKENTIJD (s/dag, hoogste eerst):");
    for (const c of credits.data ?? [])
      lines.push(
        `- ${c.project_name}: ${Math.round(c.exec_s_per_day ?? 0)} s${c.drivers?.length ? ` (${c.drivers.slice(0, 2).join(", ")})` : ""}`,
      );
  }

  // Hard plafond: ElevenLabs-variabelen moeten compact blijven.
  return cut(lines.join("\n"), 9000);
}
