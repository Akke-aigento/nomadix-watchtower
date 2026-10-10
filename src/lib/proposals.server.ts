/**
 * Auto-voorstellen: elk incident dat Watchtower herkent krijgt een
 * kant-en-klare fix met een Go-knop. Eén open voorstel per target+fingerprint.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mxRecords, type CheckOutcome } from "@/lib/checks.server";

type Target = { id: string; name: string; url: string; lovable_project_id: string | null };

type Draft = {
  fingerprint: string;
  category: "bug" | "improvement" | "security";
  title: string;
  description: string;
  proposed_action: string;
};

const SPF_BY_MX: Array<[RegExp, string, string]> = [
  [/migadu\.com$/, "include:spf.migadu.com", "Migadu"],
  [/(google|googlemail)\.com$/, "include:_spf.google.com", "Google Workspace"],
  [/outlook\.com$/, "include:spf.protection.outlook.com", "Microsoft 365"],
  [/one\.com$/, "include:_custspf.one.com", "one.com"],
  [/zoho\.(eu|com)$/, "include:zoho.eu", "Zoho"],
  [/ovh\.net$/, "include:mx.ovh.com", "OVH"],
  [/combell\.(net|com|be)$/, "include:spf.combell.com", "Combell"],
];

async function txt(name: string): Promise<string[]> {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { accept: "application/dns-json" },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { Answer?: Array<{ type?: number; data?: string }> };
  return (json.Answer ?? []).filter((a) => a.type === 16).map((a) => (a.data ?? "").replace(/"/g, ""));
}

export async function mailDnsDraft(domain: string, spfOk: boolean, dmarcOk: boolean): Promise<Draft> {
  const steps: string[] = [];
  const notes: string[] = [];
  let mx: string[] = [];
  try {
    mx = await mxRecords(domain);
  } catch {
    mx = [];
  }
  const resend = (await txt(`resend._domainkey.${domain}`).catch(() => [])).length > 0;

  if (!spfOk) {
    if (!mx.length) {
      steps.push(`TXT  ${domain}  →  v=spf1 -all`);
      notes.push(
        `${domain} ontvangt geen mail (geen MX). "-all" zegt aan de wereld dat niemand namens het hoofddomein mag mailen — dat blokkeert spoofing.`,
      );
    } else {
      const match = SPF_BY_MX.find(([re]) => mx.some((h) => re.test(h)));
      if (match) {
        steps.push(`TXT  ${domain}  →  v=spf1 ${match[1]} ~all`);
        notes.push(`Mail zit bij ${match[2]} (MX: ${mx[0]}).`);
      } else {
        steps.push(`TXT  ${domain}  →  v=spf1 mx ~all`);
        notes.push(`Mailprovider niet herkend (MX: ${mx[0]}); "mx" laat enkel de eigen mailservers toe.`);
      }
    }
  }
  if (!dmarcOk) {
    steps.push(`TXT  _dmarc.${domain}  →  v=DMARC1; p=none; adkim=r; aspf=r`);
    notes.push(`DMARC start op p=none (enkel observeren). Na twee weken zonder problemen naar p=quarantine.`);
  }
  if (resend) notes.push(`Resend verstuurt via send.${domain} met eigen SPF en DKIM — dat blijft gewoon werken.`);

  const missing = [!spfOk ? "SPF" : null, !dmarcOk ? "DMARC" : null].filter(Boolean).join(" en ");
  return {
    fingerprint: `dns:${!spfOk ? "spf" : ""}${!dmarcOk ? "dmarc" : ""}`,
    category: "security",
    title: `${missing} toevoegen op ${domain}`,
    description: `${missing} ontbreekt op ${domain}: mail van dit domein kan in spam belanden en het domein kan misbruikt worden voor phishing. ${notes.join(" ")}`,
    proposed_action: `DNS-records toevoegen bij de registrar van ${domain}:\n${steps.join("\n")}\nDaarna verdwijnt het incident vanzelf bij de volgende dagelijkse meting.`,
  };
}

async function draftFor(target: Target, o: CheckOutcome): Promise<Draft | null> {
  const d = (o.detail ?? {}) as Record<string, unknown>;
  switch (o.check_key) {
    case "dns": {
      const host = typeof d.host === "string" ? d.host : "";
      if (!host || (d.spf !== false && d.dmarc !== false)) return null;
      return mailDnsDraft(host, d.spf !== false, d.dmarc !== false);
    }
    case "http": {
      const editor = target.lovable_project_id ? ` (Lovable-project ${target.lovable_project_id})` : "";
      if (d.content_issue === "maintenance")
        return {
          fingerprint: "http:maintenance",
          category: "bug",
          title: `${target.name} staat offline — bewust?`,
          description: `${target.url} toont “${String(d.title ?? "")}”. Als dit bewust is: erken het incident (bv. 1 maand) en Watchtower zwijgt. Zo niet, dan staat er een onderhoudspagina live die er niet hoort.`,
          proposed_action: `Nagaan waarom de onderhoudspagina live staat${editor} en de normale site opnieuw publiceren.`,
        };
      if (d.content_issue === "error_page" || d.content_issue === "empty_page")
        return {
          fingerprint: `http:${d.content_issue}`,
          category: "bug",
          title: `${target.name} toont een ${d.content_issue === "empty_page" ? "lege pagina" : "foutpagina"}`,
          description: `${target.url} antwoordt wel, maar toont ${d.content_issue === "empty_page" ? "een lege pagina" : `“${String(d.title ?? "")}”`}. Waarschijnlijk een kapotte deploy.`,
          proposed_action: `Laatste deploy${editor} nakijken, vorige werkende versie herstellen of fout fixen en opnieuw publiceren.`,
        };
      if (d.content_issue === "default_title")
        return {
          fingerprint: "http:default_title",
          category: "improvement",
          title: `${target.name}: echte paginatitel zetten`,
          description: `${target.url} heeft als titel “${String(d.title ?? "")}”. Slecht voor Google en voor wie de tab ziet.`,
          proposed_action: `In index.html${editor} een echte <title> en meta description zetten.`,
        };
      return null;
    }
    case "domain":
      return {
        fingerprint: "domain:expiry",
        category: "bug",
        title: `Domein ${String(d.domain ?? "")} verlengen`,
        description: `${String(d.domain ?? "")} verloopt over ${String(d.days_left ?? "?")} dagen. Als auto-renew uit staat gaat de site én de mail plat.`,
        proposed_action: `Bij de registrar auto-renew controleren of het domein manueel verlengen.`,
      };
    default:
      return null;
  }
}

/** Zorgt dat er voor dit incident precies één open voorstel bestaat. */
export async function ensureProposal(target: Target, o: CheckOutcome, incidentId: string): Promise<void> {
  try {
    const draft = await draftFor(target, o);
    if (!draft) return;
    const { data: existing } = await supabaseAdmin
      .from("proposals")
      .select("id")
      .eq("target_id", target.id)
      .eq("fingerprint", draft.fingerprint)
      .in("status", ["proposed", "approved"])
      .limit(1)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin.from("proposals").update({ incident_id: incidentId }).eq("id", existing.id);
      return;
    }
    await supabaseAdmin.from("proposals").insert({
      target_id: target.id,
      incident_id: incidentId,
      fingerprint: draft.fingerprint,
      category: draft.category,
      title: draft.title,
      description: draft.description,
      proposed_action: draft.proposed_action,
      source: "watchtower_scan",
    });
  } catch (e) {
    console.error("ensureProposal", e);
  }
}

/** Bij herstel: open voorstellen van dit incident afsluiten. */
export async function closeProposalsFor(incidentId: string): Promise<void> {
  await supabaseAdmin
    .from("proposals")
    .update({ status: "done", decided_at: new Date().toISOString(), result: "Vanzelf opgelost: incident gesloten." })
    .eq("incident_id", incidentId)
    .eq("status", "proposed");
}
