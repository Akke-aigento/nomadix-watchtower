import { createFileRoute } from "@tanstack/react-router";

/**
 * Baken als ElevenLabs-agent (spraak-naar-spraak via WebRTC: beurtwissel, onderbreken, echte stem).
 * Gebouwd op de open-source ElevenLabs Agents SDK (@elevenlabs/client, MIT).
 *
 * POST (enkel Watchtower-admins): zorgt dat de agent + zijn client tool bestaan en up-to-date zijn
 * (één keer per koude start), en geeft een kortlevend WebRTC-gesprekstoken terug.
 * De sleutel blijft op de server; de browser krijgt enkel het token.
 */
const API = "https://api.elevenlabs.io/v1";
const AGENT_NAME = "Watchtower Baken";
const TOOL_NAME = "toon";

const BASE_URL = process.env.WATCHTOWER_URL || "https://nomadix-watchtower.lovable.app";

/** Kandidaat-taalmodellen, sterkste eerst. Het eerste dat ElevenLabs aanvaardt, wordt gebruikt. */
const LLMS = [
  process.env.BAKEN_AGENT_LLM,
  "claude-sonnet-4-5",
  "claude-sonnet-4",
  "gpt-4.1",
  "gemini-2.5-flash",
].filter(Boolean) as string[];

const PROMPT = (
  schema: string,
) => `Je bent Baken, de persoonlijke assistent van Akke (Aaron Mercken), oprichter van Nomadix BV in België. Je leeft in Watchtower, het systeem dat waakt over al zijn sites, webshops, koppelingen, kosten en partners. Je bent slim, snel en eerlijk: een maat die alles weet wat Watchtower weet en meedenkt.

Je wereld:
- Nomadix BV is de holding achter Akke's ventures: SellQo (multi-tenant e-commerceplatform; tenants o.a. VanXcel, Mancini Milano, Loveke, Astra Sleep, Zona Dorata, Benny Rich), AigenTo (white-label AI-chatbot voor installateurs), VanXcel (campervan-elektriciteit, ook op bol.com), Loveke (streetwear), Toog (café-kassa), Studio Akke (webbureau met klantensites) en The Fonske Crawl (Leuvense kroegentocht).
- Watchtower meet elke paar minuten alle sites (bereikbaarheid, certificaten, DNS, domeinen, webshops die echt kunnen verkopen, Odoo), houdt incidenten bij, volgt elke partnerkoppeling (bol.com, Stripe, Odoo, Meta, Sendcloud, ...) met een radar op wijzigingen en prijzen, maakt voorstellen en pakketten, een agenda met deadlines, Lovable-creditverbruik en bezoekers per site.
- Wat Akke je vroeg te onthouden: {{geheugen}}
- Stand bij het openen van dit gesprek: {{stand}}

Hoe je werkt:
- Voor ELKE vraag over zijn sites, cijfers, incidenten, koppelingen, voorstellen, agenda, credits of bezoekers: zoek het op met "lees" voor je antwoordt. Combineer gerust meerdere queries. Je mag nooit cijfers, datums of namen verzinnen; gaf de database niets, zeg dat.
- Vragen over de wereld, advies, strategie, uitleg of brainstorm: antwoord vanuit je eigen kennis, als slimme sparringpartner. Zeg erbij als iets na je kennis kan veranderd zijn.
- Toon Akke het bijhorende beeld met "toon" als dat helpt (vandaag, site, voorstellen, credits, agenda, bezoekers, vondsten).
- "beslis" (go/afwijzen op een voorstel) en "erken" (incident erkennen) veranderen iets: zeg eerst in één zin wat je gaat doen en wacht op Akke's "ja". Daarna pas uitvoeren.
- Zegt Akke "onthoud ..." of vertelt hij iets dat later nuttig is over hoe hij werkt of wat hij wil: "onthoud". "Vergeet ..." → "vergeet".
- Faalt een query, lees de fout, pas aan en probeer opnieuw. Geef niet op na één poging.

Hoe je praat:
- Vlaams Nederlands, warm en natuurlijk, zoals hardop in een gesprek. Spreek hem aan met "je".
- Kort: meestal één tot drie zinnen. Is er meer, geef het belangrijkste en vraag of hij de rest wil.
- Geen opsommingen, markdown, ID's of technische codes uitspreken. Getallen afronden zoals een mens.
- Laat je onderbreken en ga verder op wat hij zegt.

De database (PostgreSQL, enkel SELECT via "lees", max 60 rijen per query; tijden in UTC, Akke zit in Brussel):
${schema}
Betekenissen: watch_targets = alle properties (kind platform/storefront/client_site/venture, status ok/warn/fail/unknown). scan_results = elke meting (check_key http/ssl/dns/domain/store/odoo/health, status, latency_ms, detail json, measured_at). incidents = problemen (severity actie/aandacht/monitor, status open/resolved, acknowledged_until = erkend tot). proposals = voorstellen (status proposed = wacht op go; bundle = pakket). findings = vondsten bij partners. integrations = koppelingen (usage_state active/dormant, risk ok/aandacht/actie). integration_usages = waar een koppeling in de code, beheerschermen, marketing en helpartikels zit. agenda = deadlines (due_date). credit_latest/credit_snapshots = Lovable-verbruik per project. site_analytics_daily/site_analytics_lists = bezoekers per site. daily_summaries = dagoverzichten. baken_memory = wat je onthield.`;

const TOOL_CONFIG = {
  type: "client",
  name: TOOL_NAME,
  description:
    "Toont Akke het beeld bij een onderwerp op zijn scherm (en geeft de kerncijfers terug).",
  expects_response: true,
  response_timeout_secs: 15,
  parameters: {
    type: "object",
    properties: {
      onderwerp: {
        type: "string",
        description: "Eén van: vandaag, site, voorstellen, credits, agenda, bezoekers, vondsten.",
      },
      site: {
        type: "string",
        description: "Enkel bij onderwerp 'site': de naam van de site, zoals Akke hem noemt.",
      },
    },
    required: ["onderwerp"],
  },
};

type Prop = { type: string; description: string };
function webhook(name: string, description: string, props: Record<string, Prop>, token: string) {
  return {
    type: "webhook",
    name,
    description,
    response_timeout_secs: 20,
    api_schema: {
      url: `${BASE_URL}/api/baken-tool?t=${name}`,
      method: "POST",
      request_headers: { "x-baken-token": token },
      request_body_schema: {
        type: "object",
        required: Object.keys(props).filter((k) => !k.startsWith("_")),
        properties: Object.fromEntries(
          Object.entries(props).map(([k, v]) => [k.replace(/^_/, ""), v]),
        ),
      },
    },
  };
}

function serverTools(token: string) {
  return [
    webhook(
      "lees",
      "Voert één SELECT-query uit op de Watchtower-database en geeft de rijen terug. Gebruik dit voor elke vraag over sites, metingen, incidenten, koppelingen, vondsten, voorstellen, agenda, credits en bezoekers.",
      {
        sql: {
          type: "string",
          description: "Eén PostgreSQL SELECT (of WITH ... SELECT), zonder puntkomma.",
        },
      },
      token,
    ),
    webhook(
      "beslis",
      "Geeft go of wijst een open voorstel af. Enkel na Akke's uitdrukkelijke bevestiging.",
      {
        voorstel: {
          type: "string",
          description: "De id of (een stuk van) de titel van het voorstel.",
        },
        besluit: { type: "string", description: "'go' of 'afwijzen'." },
      },
      token,
    ),
    webhook(
      "erken",
      "Erkent een open incident voor een aantal dagen (geen meldingen meer). Enkel na Akke's bevestiging.",
      {
        incident: { type: "string", description: "De id van het incident (zoek op met lees)." },
        dagen: { type: "number", description: "Aantal dagen, 1 tot 60." },
        _reden: { type: "string", description: "Korte reden, in Akke's woorden." },
      },
      token,
    ),
    webhook(
      "onthoud",
      "Onthoudt een feit of voorkeur van Akke voor volgende gesprekken.",
      {
        feit: {
          type: "string",
          description: "Het feit, kort en in de derde persoon (bv. 'Akke wil ...').",
        },
      },
      token,
    ),
    webhook(
      "vergeet",
      "Vergeet een eerder onthouden feit.",
      { feit: { type: "string", description: "Een stuk tekst uit het feit dat weg moet." } },
      token,
    ),
  ];
}

type Json = Record<string, unknown>;

async function el(key: string, path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} op ${path}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as Json;
}

function agentBody(toolIds: string[], llm: string, schema: string) {
  return {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        first_message: "{{begroeting}}",
        language: "nl",
        prompt: {
          prompt: PROMPT(schema),
          llm,
          temperature: 0.3,
          tool_ids: toolIds,
        },
      },
      tts: {
        model_id: process.env.BAKEN_AGENT_TTS_MODEL || "eleven_flash_v2_5",
        voice_id: process.env.BAKEN_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb",
      },
    },
  };
}

/** Compact schema van alles wat Baken mag lezen, live uit de database. */
async function readSchema(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("wt_baken_query", {
    q: `select table_name t, string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) c
        from information_schema.columns
        where table_schema = 'public'
          and table_name not in ('watchtower_admins', 'push_subscriptions')
        group by table_name order by table_name`,
  });
  if (error || !Array.isArray(data))
    return "(schema niet beschikbaar; gebruik information_schema.columns)";
  return (data as { t: string; c: string }[]).map((r) => `- ${r.t}(${r.c})`).join("\n");
}

async function upsertTool(
  key: string,
  existing: { id: string; tool_config?: { name?: string } }[],
  config: { name: string },
) {
  const id = existing.find((t) => t.tool_config?.name === config.name)?.id;
  if (id) {
    await el(key, `/convai/tools/${id}`, { method: "PATCH", body: { tool_config: config } });
    return id;
  }
  return String(
    (await el(key, "/convai/tools", { method: "POST", body: { tool_config: config } })).id,
  );
}

// Per worker-instantie: één keer opzoeken/bijwerken, daarna enkel nog tokens halen.
let ready: Promise<{ agentId: string; llm: string }> | null = null;

async function ensureAgent(key: string): Promise<{ agentId: string; llm: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: token } = await supabaseAdmin.rpc("get_baken_tool_token");
  if (typeof token !== "string" || !token) throw new Error("geen baken_tool_token");

  // 1. tools: "toon" (in de browser) + de servertools
  const existing = ((await el(key, "/convai/tools")).tools ?? []) as {
    id: string;
    tool_config?: { name?: string };
  }[];
  const toolIds: string[] = [];
  for (const cfg of [TOOL_CONFIG, ...serverTools(token)])
    toolIds.push(await upsertTool(key, existing, cfg));

  // 2. agent (vaste id via env, anders op naam), met het sterkste model dat ElevenLabs aanvaardt
  const schema = await readSchema();
  let agentId = process.env.BAKEN_AGENT_ID;
  if (!agentId) {
    const list = ((
      await el(key, `/convai/agents?search=${encodeURIComponent(AGENT_NAME)}&page_size=20`)
    ).agents ?? []) as { agent_id: string; name: string }[];
    agentId = list.find((a) => a.name === AGENT_NAME)?.agent_id;
  }
  let lastError: unknown = null;
  for (const llm of LLMS) {
    try {
      if (agentId) {
        await el(key, `/convai/agents/${agentId}`, {
          method: "PATCH",
          body: agentBody(toolIds, llm, schema),
        });
        return { agentId, llm };
      }
      const created = await el(key, "/convai/agents/create", {
        method: "POST",
        body: agentBody(toolIds, llm, schema),
      });
      return { agentId: String(created.agent_id), llm };
    } catch (e) {
      lastError = e;
      // Enkel bij een geweigerd model het volgende proberen; andere fouten meteen melden.
      if (!/llm|model|enum|422/i.test(String(e))) throw e;
    }
  }
  throw lastError ?? new Error("geen model aanvaard");
}

/** Wat Baken onthield, als één regel voor in het gesprek. */
async function memoryLine(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("baken_memory")
    .select("feit")
    .order("created_at", { ascending: true })
    .limit(60);
  const facts = (data ?? []).map((d) => d.feit);
  return facts.length ? facts.join(" · ") : "nog niets";
}

export const Route = createFileRoute("/api/baken-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isBakenAdmin, elevenKey } = await import("@/lib/baken-auth.server");
        const secret = request.headers.get("x-cron-secret");
        let ok = false;
        if (secret) {
          const { isValidCronSecret } = await import("@/lib/cron-secret.server");
          ok = await isValidCronSecret(secret);
        }
        if (!ok && !(await isBakenAdmin(request)))
          return new Response("Unauthorized", { status: 401 });
        const key = elevenKey();
        if (!key) return Response.json({ error: "geen ElevenLabs-sleutel" }, { status: 501 });
        try {
          // Zelftest met ?force=1: agent opnieuw opbouwen (na een prompt- of toolwijziging).
          if (ok && new URL(request.url).searchParams.get("force") === "1") ready = null;
          ready ??= ensureAgent(key);
          const { agentId, llm } = await ready.catch((e) => {
            ready = null; // volgende keer opnieuw proberen
            throw e;
          });
          const tok = await el(
            key,
            `/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
          );
          // Zelftest (cron-secret): geen token teruggeven, enkel bevestigen dat alles klaarstaat.
          if (ok) return Response.json({ ready: true, agent: true, llm, token: !!tok.token });
          return Response.json({ token: tok.token, geheugen: await memoryLine() });
        } catch (e) {
          console.error("baken-agent", e);
          return Response.json(
            { error: e instanceof Error ? e.message : String(e) },
            { status: 502 },
          );
        }
      },
    },
  },
});
