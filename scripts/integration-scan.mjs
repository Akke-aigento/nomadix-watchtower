#!/usr/bin/env node
/**
 * Integratie-scanner — Watchtower ontdekt zelf met welke partners de code praat.
 *
 *   node scripts/integration-scan.mjs <repo-naam>=<pad> [<repo-naam>=<pad> ...] > scan.json
 *
 * Output (JSON): { scanned_at, integrations: [...], usages: [...], unknown_hosts: [...] }
 *  - integrations : bekende partners uit de catalogus die in de code voorkomen, met gevonden versies
 *  - usages       : per partner/repo/bestand/versie het aantal voorkomens
 *  - unknown_hosts: externe hosts die niet in de catalogus staan → worden automatisch
 *                   geregistreerd als nieuwe koppeling ("host:<domein>"), zodat niets onopgemerkt blijft.
 *
 * Geen dependencies; leest enkel bestanden. De catalogus groeit: elk onbekend domein dat
 * de assistent herkent, voegt hij hier toe (met partner, categorie, docs en statuspagina).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** key → herkenning + metadata. versionRe vangt de API-versie uit de code (groep 1). */
export const CATALOG = [
  { key: "bol_retailer", domains: ["bol.com"], name: "bol.com Retailer API", partner: "bol.com", category: "marketplace", hostRe: /api\.bol\.com\/retailer|login\.bol\.com/, versionRe: /application\/vnd\.retailer\.(v\d+)\+json/g, docs: "https://api.bol.com/retailer/public/Retailer-API/", changelog: "https://developers.bol.com/en/news/", names: /bol\.com/i, pricing: "https://partnerplatform.bol.com/" },
  { key: "bol_advertising", name: "bol.com Advertising API", partner: "bol.com", category: "marketplace", hostRe: /api\.bol\.com\/advertiser/, versionRe: /application\/vnd\.advertiser\.(v\d+)\+json/g, docs: "https://api.bol.com/advertiser/docs/", changelog: "https://developers.bol.com/en/news/" },
  { key: "amazon_sp", domains: ["amazon.com", "amazon.nl", "amazon.de"], name: "Amazon Selling Partner API", partner: "Amazon", category: "marketplace", hostRe: /sellingpartnerapi-[a-z]+\.amazon\.com|api\.amazon\.com\/auth/, versionRe: /\/(\d{4}-\d{2}-\d{2})\b/g, docs: "https://developer-docs.amazon.com/sp-api/", changelog: "https://developer-docs.amazon.com/sp-api/changelog", names: /\bAmazon\b/ },
  { key: "ebay", domains: ["ebay.com"], name: "eBay Sell APIs", partner: "eBay", category: "marketplace", hostRe: /api\.ebay\.com/, versionRe: /api\.ebay\.com\/(?:sell|commerce|identity)\/[a-z_]+\/(v\d+)/g, docs: "https://developer.ebay.com/develop/apis", changelog: "https://developer.ebay.com/develop/api-status", names: /\beBay\b/i },
  { key: "shopify_admin", domains: ["shopify.com", "myshopify.com"], name: "Shopify Admin API", partner: "Shopify", category: "marketplace", hostRe: /myshopify\.com|admin\/api\/\d{4}-\d{2}/, versionRe: /admin\/api\/(\d{4}-\d{2})/g, docs: "https://shopify.dev/docs/api/usage/versioning", changelog: "https://shopify.dev/changelog", status: "https://www.shopifystatus.com", names: /\bShopify\b/, pricing: "https://www.shopify.com/pricing" },
  { key: "woocommerce", name: "WooCommerce REST API", partner: "WooCommerce", category: "marketplace", hostRe: /wc\/v\d/, versionRe: /wc\/(v\d+)/g, docs: "https://woocommerce.github.io/woocommerce-rest-api-docs/", names: /\bWooCommerce\b/i },
  { key: "meta_graph", domains: ["facebook.com", "instagram.com"], name: "Meta Graph API (Facebook/Instagram/WhatsApp)", partner: "Meta", category: "social", hostRe: /graph\.facebook\.com|facebook\.com\/v\d/, versionRe: /facebook\.com\/(v\d+\.\d+)/g, docs: "https://developers.facebook.com/docs/graph-api/changelog/versions", changelog: "https://developers.facebook.com/docs/graph-api/changelog/", names: /\b(Facebook|Instagram|WhatsApp|Meta Business)\b/ },
  { key: "printful", domains: ["printful.com"], name: "Printful API", partner: "Printful", category: "fulfilment", hostRe: /api\.printful\.com/, versionRe: /api\.printful\.com\/(v\d+)\//g, docs: "https://developers.printful.com/docs/", changelog: "https://developers.printful.com/docs/changelog", names: /\bPrintful\b/i, pricing: "https://www.printful.com/pricing" },
  { key: "sendcloud", domains: ["sendcloud.sc"], name: "Sendcloud API", partner: "Sendcloud", category: "shipping", hostRe: /panel\.sendcloud\.sc/, versionRe: /sendcloud\.sc\/api\/(v\d+)/g, docs: "https://api.sendcloud.dev/docs/", changelog: "https://api.sendcloud.dev/docs/changelog", status: "https://status.sendcloud.com", names: /\bSendcloud\b/i, pricing: "https://www.sendcloud.com/pricing/" },
  { key: "myparcel", domains: ["myparcel.nl"], name: "MyParcel API", partner: "MyParcel", category: "shipping", hostRe: /api\.myparcel\.nl/, docs: "https://developer.myparcel.nl/", status: "https://status.myparcel.nl", names: /\bMyParcel\b/i },
  { key: "dhl", domains: ["dhl.com", "dhl.de"], name: "DHL API", partner: "DHL", category: "shipping", hostRe: /dhl\.com/, docs: "https://developer.dhl.com/", names: /\bDHL\b/ },
  { key: "postnl", domains: ["postnl.nl"], name: "PostNL Track & Trace", partner: "PostNL", category: "shipping", hostRe: /postnl\.nl/, names: /\bPostNL\b/i },
  { key: "gls", domains: ["gls-group.eu"], name: "GLS", partner: "GLS", category: "shipping", hostRe: /gls-group\.eu/, names: /\bGLS\b/ },
  { key: "odoo", domains: ["odoo.com"], name: "Odoo External API", partner: "Odoo", category: "accounting", hostRe: /\/jsonrpc|\/xmlrpc|\/json\/2\//, versionRe: /['"`](\/jsonrpc|\/xmlrpc(?:\/2)?|\/json\/2)\b/g, docs: "https://www.odoo.com/documentation/19.0/developer/reference/external_api.html", changelog: "https://www.odoo.com/odoo-19-release-notes", names: /\bOdoo\b/i, pricing: "https://www.odoo.com/pricing" },
  { key: "stripe", domains: ["stripe.com"], name: "Stripe API", partner: "Stripe", category: "payments", hostRe: /stripe@|from ["']stripe["']|api\.stripe\.com/, versionRe: /apiVersion:\s*['"]([^'"]+)['"]/g, docs: "https://docs.stripe.com/upgrades", changelog: "https://docs.stripe.com/changelog", names: /\bStripe\b/, pricing: "https://stripe.com/be/pricing" },
  { key: "resend", domains: ["resend.com"], name: "Resend", partner: "Resend", category: "mail", hostRe: /api\.resend\.com|resend@/, versionRe: /resend@([\d.]+)/g, docs: "https://resend.com/docs", changelog: "https://resend.com/changelog", status: "https://resend-status.com", names: /\bResend\b/, pricing: "https://resend.com/pricing" },
  { key: "lovable_ai", domains: ["lovable.dev"], name: "Lovable AI Gateway", partner: "Lovable", category: "ai", hostRe: /ai\.gateway\.lovable\.dev/, versionRe: /model:\s*['"]([a-z0-9./-]+)['"]/g, docs: "https://docs.lovable.dev/", changelog: "https://docs.lovable.dev/changelog", status: "https://status.lovable.dev" },
  { key: "anthropic", domains: ["anthropic.com"], name: "Claude API", partner: "Anthropic", category: "ai", hostRe: /api\.anthropic\.com|@anthropic-ai\/sdk/, versionRe: /model:\s*['"](claude-[a-z0-9.-]+)['"]/g, docs: "https://docs.claude.com/", changelog: "https://docs.claude.com/en/release-notes/api", status: "https://status.anthropic.com", names: /\b(Anthropic|Claude)\b/, pricing: "https://www.anthropic.com/pricing" },
  { key: "openai", domains: ["openai.com"], name: "OpenAI API", partner: "OpenAI", category: "ai", hostRe: /api\.openai\.com/, docs: "https://platform.openai.com/docs/deprecations", status: "https://status.openai.com", names: /\b(OpenAI|ChatGPT)\b/ },
  { key: "supabase", name: "Supabase", partner: "Supabase", category: "infra", hostRe: /supabase-js@|@supabase\/supabase-js/, versionRe: /supabase-js@([\d.]+)/g, docs: "https://supabase.com/docs", changelog: "https://supabase.com/changelog", status: "https://status.supabase.com" },
  { key: "cloudflare", domains: ["cloudflare.com", "cloudflare-dns.com"], name: "Cloudflare API", partner: "Cloudflare", category: "infra", hostRe: /api\.cloudflare\.com|cloudflare-dns\.com/, versionRe: /api\.cloudflare\.com\/client\/(v\d+)/g, docs: "https://developers.cloudflare.com/api/", changelog: "https://developers.cloudflare.com/changelog/", status: "https://www.cloudflarestatus.com" },
  { key: "google_fcm", domains: ["googleapis.com"], name: "Firebase Cloud Messaging", partner: "Google", category: "push", hostRe: /fcm\.googleapis\.com|firebase\.messaging/, versionRe: /fcm\.googleapis\.com\/(v\d+)/g, docs: "https://firebase.google.com/docs/cloud-messaging" },
  { key: "google_maps", name: "Google Maps API", partner: "Google", category: "other", hostRe: /maps\.googleapis\.com/, names: /\bGoogle Maps\b/ },
  { key: "vies", domains: ["europa.eu"], name: "EU VIES (btw-validatie)", partner: "Europese Commissie", category: "compliance", hostRe: /ec\.europa\.eu\/taxation_customs\/vies/, names: /\bVIES\b/ },
  { key: "intervat", domains: ["fgov.be"], name: "Intervat (FOD Financiën)", partner: "FOD Financiën", category: "compliance", hostRe: /intervat\.minfin\.fgov\.be/ },
  { key: "linkedin", domains: ["linkedin.com"], name: "LinkedIn API", partner: "LinkedIn", category: "social", hostRe: /api\.linkedin\.com|linkedin\.com\/oauth/, versionRe: /api\.linkedin\.com\/(v\d+)/g, names: /\bLinkedIn\b/ },
  { key: "x_twitter", domains: ["twitter.com"], name: "X (Twitter) API", partner: "X", category: "social", hostRe: /api\.twitter\.com|twitter\.com\/i\/oauth2/, versionRe: /api\.twitter\.com\/(\d+)\//g, names: /\b(Twitter|X \(Twitter\))\b/ },
  { key: "tiktok", name: "TikTok API", partner: "TikTok", category: "social", hostRe: /tiktok(apis)?\.com/, names: /\bTikTok\b/i },
  { key: "klaviyo", domains: ["klaviyo.com"], name: "Klaviyo API", partner: "Klaviyo", category: "mail", hostRe: /klaviyo\.com/, names: /\bKlaviyo\b/i },
  { key: "mailchimp", domains: ["mailchimp.com"], name: "Mailchimp API", partner: "Mailchimp", category: "mail", hostRe: /api\.mailchimp\.com|\.api\.mailchimp/, names: /\bMailchimp\b/i },
  { key: "trustpilot", domains: ["trustpilot.com"], name: "Trustpilot API", partner: "Trustpilot", category: "reviews", hostRe: /api\.trustpilot\.com/, names: /\bTrustpilot\b/i },
  { key: "kiyoh", domains: ["kiyoh.com"], name: "Kiyoh API", partner: "Kiyoh", category: "reviews", hostRe: /kiyoh\.com/, names: /\bKiyoh\b/i },
  { key: "webwinkelkeur", domains: ["webwinkelkeur.nl"], name: "WebwinkelKeur API", partner: "WebwinkelKeur", category: "reviews", hostRe: /webwinkelkeur\.nl/, names: /\bWebwinkelKeur\b/i },
  { key: "trustedshops", domains: ["trustedshops.com"], name: "Trusted Shops API", partner: "Trusted Shops", category: "reviews", hostRe: /trustedshops\.com/, names: /\bTrusted ?Shops\b/i },
  { key: "peppol", name: "Peppol e-facturatie", partner: "Peppol (via Odoo)", category: "compliance", hostRe: /peppol_(status|id|required|endpoint)/, names: /\bPeppol\b/i, docs: "https://financien.belgium.be/nl/ondernemingen/btw/e-facturatie" },
  { key: "migadu", domains: ["migadu.com"], name: "Migadu (IMAP/SMTP)", partner: "Migadu", category: "mail", hostRe: /migadu\.com/ },
];

/** Hosts die geen koppeling zijn (docs, CDN's, voorbeeld-URL's, eigen domeinen). */
const IGNORE_HOST = /(^|\.)(deno\.land|esm\.sh|jsr\.io|npmjs\.(com|org)|unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|github\.com|githubusercontent\.com|w3\.org|schema\.org|example\.(com|org)|localhost|sellqo\.app|lovable\.app|supabase\.co|fonts\.(googleapis|gstatic)\.com|googletagmanager\.com|google-analytics\.com|wikipedia\.org|x\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com|placehold\.co|images\.unsplash\.com|unsplash\.com|docs\.[a-z.]+|developer\.[a-z.]+|developers\.[a-z.]+|shopify\.dev|peppol\.eu|qrserver\.com|sitemaps\.org|www\.google\.com)$/;

const SERVER_CODE = /(^|\/)supabase\/functions\/|\.server\.[tj]s$|(^|\/)routes\/api\/|(^|\/)server\//;
const SELF = /integration-scan\.mjs$/;
/** Watchtower-bestanden die partner-URL's als gegevens bevatten (catalogus, voorstelteksten), geen aanroepen. */
const CATALOG_DATA = /(^|\/)src\/lib\/proposals\.server\.ts$/;
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|jsx)$/;
const SKIP_DIR = new Set(["node_modules", ".git", "dist", "build", ".output", ".wrangler", "coverage", "public", "ios", "android", ".next"]);

/**
 * Impactkaart: waar in de keten een partner bij naam voorkomt, los van de API-aanroepen.
 *  beheer      : schermen waar een tenant koppelt of instelt (admin, onboarding, app-vertalingen)
 *  marketing   : publieke beloftes (landing, publieke pagina's, landing-vertalingen)
 *  helpartikel : in-app documentatie — via ingestDocArticles(), uit de live SellQo-DB
 */
export function touchKind(file) {
  if (/(^|\/)src\/i18n\/locales\/landing\.[a-z-]+\.json$/.test(file)) return "marketing";
  if (/(^|\/)src\/(components\/landing|pages\/public)\/|(^|\/)src\/pages\/Landing\.tsx$/.test(file)) return "marketing";
  if (/(^|\/)src\/i18n\/locales\/[a-z-]+(\.[a-z-]+)?\.json$/.test(file)) return "beheer";
  if (/(^|\/)src\/(components|pages)\/(admin|onboarding|settings|platform)\//.test(file)) return "beheer";
  // Helpartikels komen uit de live doc_articles van SellQo (repo 'sellqo-db'), niet uit migraties:
  // een deel bestaat enkel live.
  return null;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if ((CODE_EXT.test(name) || /\.json$/.test(name)) && st.size < 2_000_000 && !/\.(test|spec)\./.test(name)) yield p;
  }
}

function scan(repos) {
  const usages = new Map(); // key|repo|file|version → count
  const found = new Map(); // key → Set(versions)
  const unknown = new Map(); // host → {count, files:Set}

  for (const [repo, root] of repos) {
    for (const path of walk(root)) {
      const file = relative(root, path);
      if (SELF.test(file) || CATALOG_DATA.test(file)) continue;
      const text = readFileSync(path, "utf8");
      const tk = touchKind(file);
      if (tk) {
        for (const c of CATALOG) {
          if (!c.names) continue;
          const n = (text.match(new RegExp(c.names.source, c.names.flags.includes("g") ? c.names.flags : c.names.flags + "g")) ?? []).length;
          if (!n) continue;
          // Vertalingen per taal samenvatten: één rij per bestandsfamilie, niet per taal.
          const f = file.replace(/(locales\/(?:landing\.)?)[a-z]{2}(?:-[a-z]{2})?\.json$/i, "$1*.json");
          const k = `${c.key}|${repo}|${f}||${tk}`;
          usages.set(k, (usages.get(k) ?? 0) + n);
          if (!found.has(c.key)) found.set(c.key, new Set());
        }
      }
      if (!CODE_EXT.test(file)) continue;
      for (const c of CATALOG) {
        if (!c.hostRe.test(text)) continue;
        const versions = new Map();
        if (c.versionRe) {
          for (const m of text.matchAll(c.versionRe)) versions.set(m[1], (versions.get(m[1]) ?? 0) + 1);
        }
        if (!versions.size) versions.set("", (text.match(new RegExp(c.hostRe.source, "g")) ?? []).length || 1);
        for (const [v, n] of versions) {
          const k = `${c.key}|${repo}|${file}|${v}|code`;
          usages.set(k, (usages.get(k) ?? 0) + n);
          if (!found.has(c.key)) found.set(c.key, new Set());
          if (v) found.get(c.key).add(v);
        }
      }
      // Onbekende hosts enkel in servercode: daar gebeuren echte API-aanroepen
      // (UI-bestanden bevatten vooral voorbeeld-URL's en links naar dashboards).
      if (!SERVER_CODE.test(file) || SELF.test(file)) continue;
      for (const m of text.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)([^\s'"`)]*)/gi)) {
        const host = m[1].toLowerCase();
        if (IGNORE_HOST.test(host)) continue;
        if (CATALOG.some((c) => c.hostRe.test(m[0]) || (c.domains ?? []).some((d) => host === d || host.endsWith("." + d)))) continue;
        const u = unknown.get(host) ?? { count: 0, files: new Set(), repos: new Set() };
        u.count++;
        u.files.add(file);
        u.repos.add(repo);
        unknown.set(host, u);
      }
    }
  }

  return {
    scanned_at: new Date().toISOString(),
    integrations: [...found.entries()].map(([key, versions]) => {
      const c = CATALOG.find((x) => x.key === key);
      return {
        key,
        name: c.name,
        partner: c.partner,
        category: c.category,
        versions: [...versions].sort(),
        docs_url: c.docs ?? null,
        changelog_url: c.changelog ?? null,
        status_page_url: c.status ?? null,
        pricing_url: c.pricing ?? null,
      };
    }),
    usages: [...usages.entries()].map(([k, n]) => {
      const [key, repo, file, version, kind] = k.split("|");
      return { integration_key: key, repo, file, version, occurrences: n, kind };
    }),
    unknown_hosts: [...unknown.entries()]
      .filter(([, u]) => u.count >= 1)
      .map(([host, u]) => ({ host, occurrences: u.count, repos: [...u.repos], files: [...u.files].slice(0, 5) }))
      .sort((a, b) => b.occurrences - a.occurrences),
  };
}

/** Zet het scanresultaat om naar idempotente SQL voor de Watchtower-DB. */
function toSql(result) {
  const q = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
  const lines = ["BEGIN;"];
  for (const i of result.integrations) {
    lines.push(
      `INSERT INTO public.integrations (key, name, partner, category, used_version, docs_url, changelog_url, status_page_url, discovered_via, last_seen_at)
VALUES (${q(i.key)}, ${q(i.name)}, ${q(i.partner)}, ${q(i.category)}, ${q(i.versions.join(", ") || null)}, ${q(i.docs_url)}, ${q(i.changelog_url)}, ${q(i.status_page_url)}, 'code', now())
ON CONFLICT (key) DO UPDATE SET used_version = EXCLUDED.used_version, last_seen_at = now(),
  docs_url = coalesce(public.integrations.docs_url, EXCLUDED.docs_url),
  changelog_url = coalesce(public.integrations.changelog_url, EXCLUDED.changelog_url),
  status_page_url = coalesce(public.integrations.status_page_url, EXCLUDED.status_page_url);`,
    );
  }
  for (const h of result.unknown_hosts) {
    lines.push(
      `INSERT INTO public.integrations (key, name, partner, category, discovered_via, notes, last_seen_at)
VALUES (${q("host:" + h.host)}, ${q(h.host)}, ${q(h.host)}, 'unclassified', 'code', ${q(`Zelf ontdekt in ${h.repos.join(", ")}: ${h.files.join(", ")}`)}, now())
ON CONFLICT (key) DO UPDATE SET last_seen_at = now();`,
    );
  }
  const repos = [...new Set(result.usages.map((u) => u.repo))];
  for (const r of repos) lines.push(`DELETE FROM public.integration_usages WHERE repo = ${q(r)};`);
  for (const u of result.usages) {
    lines.push(
      `INSERT INTO public.integration_usages (integration_key, repo, file, version, occurrences, kind) VALUES (${q(u.integration_key)}, ${q(u.repo)}, ${q(u.file)}, ${q(u.version)}, ${u.occurrences}, ${q(u.kind)}) ON CONFLICT (integration_key, repo, file, version, kind) DO UPDATE SET occurrences = EXCLUDED.occurrences, scanned_at = now();`,
    );
  }
  lines.push("COMMIT;");
  return lines.join("\n");
}

/**
 * Compacte vorm voor public.wt_ingest_scan(jsonb): één SQL-call, enkele tientallen KB.
 *   select public.wt_ingest_scan('<json>'::jsonb);
 */
/** SDK-pins (supabase-js) zitten in honderden bestanden: per versie samenvatten i.p.v. per bestand. */
const AGGREGATE_KEYS = new Set(["supabase"]);

function toCompact(result) {
  const agg = new Map();
  const usages = [];
  for (const x of result.usages) {
    if (!AGGREGATE_KEYS.has(x.integration_key) || x.kind !== "code") {
      usages.push(x);
      continue;
    }
    const k = `${x.integration_key}|${x.repo}|${x.version}|${x.kind}`;
    const a = agg.get(k) ?? { ...x, file: "", files: 0, occurrences: 0 };
    a.files++;
    a.occurrences += x.occurrences;
    a.file = `(${a.files} bestanden)`;
    agg.set(k, a);
  }
  result = { ...result, usages: [...usages, ...agg.values()] };
  return {
    i: result.integrations.map((x) => [x.key, x.name, x.partner, x.category, x.versions.join(", "), x.docs_url, x.changelog_url, x.status_page_url, x.pricing_url]),
    u: result.usages.map((x) => [x.integration_key, x.repo, x.file, x.version, x.occurrences, x.kind]),
    h: result.unknown_hosts.map((x) => [x.host, x.repos.join(", "), x.files.join(", ")]),
    r: [...new Set(result.usages.map((x) => x.repo))],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const sqlMode = args.includes("--sql");
  const compactMode = args.includes("--compact");
  const repos = args.filter((a) => a.includes("=")).map((a) => a.split("="));
  if (!repos.length) {
    console.error("gebruik: node scripts/integration-scan.mjs [--sql] <repo>=<pad> ...");
    process.exit(1);
  }
  const result = scan(repos);
  if (compactMode) {
    const json = JSON.stringify(toCompact(result)).replace(/'/g, "''");
    process.stdout.write(`select public.wt_ingest_scan('${json}'::jsonb);`);
  } else process.stdout.write(sqlMode ? toSql(result) : JSON.stringify(result, null, 2));
}

export { scan, toSql, toCompact };
